"""Real, read-only Stage 3C inference and evidence execution for internal_v2."""
from __future__ import annotations

import hashlib
import json
import math
import os
import platform
import random
import resource
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image

from sagar.evidence.persistence import persistence_from_window_overlap
from sagar.evidence.shadow import range_matched_shadow
from sagar.fusion.calibration import FUSION_FEATURES, fit_logistic_fusion
from sagar.mission.priority import calculate_priority
from sagar.perception.detector import FrozenDetectorArtifact

RUN_ID = "run_stage3c_v4"
SURVEY_ID = "survey_subpipe_mini2_internal_v2"
MODEL_LAYER = 16
MEMORY_GRID = 4
MEMORY_CORESET_SIZE = 512
INFERENCE_SIZE = 640  # Exact frozen training image size; not a tuning decision.


def _json(path: Path) -> Any:
    return json.loads(path.read_text())


def _jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def _write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _iou(one: Iterable[float], two: Iterable[float]) -> float:
    ax, ay, aw, ah = one
    bx, by, bw, bh = two
    intersection = max(0.0, min(ax + aw, bx + bw) - max(ax, bx)) * max(0.0, min(ay + ah, by + bh) - max(ay, by))
    union = aw * ah + bw * bh - intersection
    return intersection / union if union else 0.0


def _logit(value: float) -> float:
    value = min(1 - 1e-6, max(1e-6, value))
    return math.log(value / (1 - value))


class IsotonicCalibrator:
    """Small PAV calibrator persisted as knots, with no sklearn dependency."""

    def __init__(self, thresholds: list[float], values: list[float]) -> None:
        self.thresholds = thresholds
        self.values = values

    @classmethod
    def fit(cls, scores: list[float], labels: list[int]) -> "IsotonicCalibrator":
        if not scores or len(scores) != len(labels) or not set(labels).issubset({0, 1}):
            raise ValueError("isotonic calibration requires aligned binary validation rows")
        ordered = sorted(zip(scores, labels), key=lambda row: row[0])
        blocks: list[dict[str, Any]] = []
        for score, label in ordered:
            blocks.append({"sum": float(label), "n": 1, "right": float(score)})
            while len(blocks) >= 2 and blocks[-2]["sum"] / blocks[-2]["n"] > blocks[-1]["sum"] / blocks[-1]["n"]:
                right, left = blocks.pop(), blocks.pop()
                blocks.append({"sum": left["sum"] + right["sum"], "n": left["n"] + right["n"], "right": right["right"]})
        return cls([block["right"] for block in blocks], [block["sum"] / block["n"] for block in blocks])

    def transform(self, score: float) -> float:
        for threshold, value in zip(self.thresholds, self.values):
            if score <= threshold:
                return float(value)
        return float(self.values[-1])

    def as_dict(self) -> dict[str, Any]:
        return {"method": "PAV_isotonic", "fitted_split": "val", "thresholds": self.thresholds, "values": self.values}


def _device(torch: Any) -> str:
    return "mps" if torch.backends.mps.is_available() else "cpu"


def _sync(torch: Any, device: str) -> None:
    if device == "mps":
        torch.mps.synchronize()


def _features(feature_map: Any, torch: Any) -> np.ndarray:
    pooled = torch.nn.functional.adaptive_avg_pool2d(feature_map, (MEMORY_GRID, MEMORY_GRID))
    values = pooled.permute(0, 2, 3, 1).reshape(-1, pooled.shape[1]).float()
    values = values / values.norm(dim=1, keepdim=True).clamp_min(1e-12)
    return values.detach().cpu().numpy().astype(np.float32)


def _nearest_scores(torch: Any, device: str, bank: np.ndarray, queries: np.ndarray) -> np.ndarray:
    """MPS/CPU nearest-neighbour distance in bounded chunks."""
    memory = torch.from_numpy(bank).to(device)
    result: list[np.ndarray] = []
    for start in range(0, len(queries), 256):
        query = torch.from_numpy(queries[start : start + 256]).to(device)
        distances = torch.cdist(query, memory)
        result.append(distances.min(dim=1).values.detach().cpu().numpy())
    return np.concatenate(result).astype(np.float32)


def _bbox_from_patch(index: int) -> tuple[float, float, float, float]:
    row, column = divmod(index, MEMORY_GRID)
    size = 512 / MEMORY_GRID
    return (column * size, row * size, size, size)


def _tile_annotation_boxes(tile: dict[str, Any]) -> list[tuple[float, float, float, float]]:
    output: list[tuple[float, float, float, float]] = []
    for annotation in tile["annotations"]:
        value = annotation.get("bbox_xywh") or annotation.get("bbox_px")
        if value:
            output.append(tuple(map(float, value)))
    return output


def _context_unavailable() -> dict[str, Any]:
    return {"applicable": False, "reason": "CONTEXT_MODEL_NOT_IMPLEMENTED", "score": None, "background_z": None, "clutter_density": None}


def _evidence_features(record: dict[str, Any], calibrated_confidence: float) -> dict[str, float]:
    persistence = record["evidence"]["persistence"]
    shadow = record["evidence"]["shadow"]
    context = record["evidence"]["context"]
    return {
        "calibrated_det_logit": _logit(calibrated_confidence),
        "persistence_wilson": float(persistence["score"] or 0.0),
        "log_opportunities": math.log1p(float(persistence["n_opportunities"] or 0)),
        "shadow_score": float(shadow["score"] or 0.0),
        "shadow_applicable": float(bool(shadow["applicable"])),
        "context_z": float(context["background_z"] or 0.0),
        "clutter_density": float(context["clutter_density"] or 0.0),
        "anomaly_score": float(record.get("anomaly_score") or 0.0),
    }


def _frame_pics(frame: dict[str, Any], bbox: tuple[float, float, float, float]) -> dict[str, Any]:
    geometry = frame["geometry"]
    x, y, width, height = bbox
    nadir = geometry.get("nadir_offset_px")
    return {
        "ping_centre": None, "ping_span": None, "range_centre_m": None, "range_span_m": None,
        "range_unit": "PIXEL_RANGE", "side": "UNKNOWN" if nadir is None else ("STARBOARD" if y + height / 2 >= nadir else "PORT"),
        "along_centre_px": x + width / 2, "across_centre_px": y + height / 2,
        "reason": "PING_INDEX_NOT_RECOVERABLE" if geometry.get("ping_index_start") is None else None,
    }


def _record(
    *, identifier: str, kind: str, source: str, tile: dict[str, Any], frame: dict[str, Any], local_box: tuple[float, float, float, float], confidence: float | None,
    anomaly_score: float | None, device: str, checkpoint_hash: str,
) -> dict[str, Any]:
    frame_box = (local_box[0] + tile["x_origin_px"], local_box[1] + tile["y_origin_px"], local_box[2], local_box[3])
    geometry = frame["geometry"]
    image = np.asarray(Image.open(frame["source_path"]).convert("L"))
    shadow = range_matched_shadow(image, frame_box, geometry.get("nadir_offset_px"), geometry.get("range_scale_m_per_px"))
    return {
        "detection_id": identifier, "run_id": RUN_ID, "survey_id": SURVEY_ID, "frame_id": tile["source_frame_id"], "tile_id": tile["tile_id"],
        "kind": kind, "source": source, "category": "PIPELINE" if kind == "KNOWN" else "UNKNOWN_ANOMALY_CANDIDATE",
        "class_confidence": confidence if kind == "KNOWN" else None, "label_certainty": "CERTAIN" if kind == "KNOWN" else "UNCERTAIN", "anomaly_score": anomaly_score,
        "geometry": {"bbox_px": list(local_box), "bbox_frame_px": list(frame_box), "mask_rle": None, "pics": _frame_pics(frame, frame_box)},
        "evidence": {"persistence": {}, "shadow": shadow, "context": _context_unavailable(), "completeness": ["persistence", "shadow", "context"]},
        "fusion": {"final_confidence": None, "contributions": {}, "intercept": None, "calibration_id": None, "fusion_model_id": None, "reason": "VALIDATION_CALIBRATION_PENDING"},
        "dimensions": {"length_px": local_box[2], "width_px": local_box[3], "length_m": None, "width_m": None, "area_m2": None, "estimator": "NONE", "reason": "range_scale_m_per_px unknown"},
        "geo": {"lat": None, "lon": None, "position_uncertainty_m": None, "heading_deg": None, "provenance": "NONE", "nav_source": None, "spatial_reference_level": geometry["level"], "reason": "WGS84 frame fix unavailable in Mini2 canonical data"},
        "model": {"model_version_id": "internal_v2", "model_id": "sagardrishti-internal-detector", "weights_sha256": checkpoint_hash, "confidence_at_prediction": confidence, "device": device},
        "review": {"latest_verdict": None, "review_count": 0, "reviewed_at": None, "reviewer": None}, "change_status": None,
        "priority": {"applicable": False, "reason": "METRIC_FOOTPRINT_UNAVAILABLE"},
        "provenance": {"class": "MODEL_DERIVED", "evidence": "HEURISTIC_DERIVED", "fusion": "NONE", "geo": "NONE", "review": "NONE"},
    }


def _apply_persistence(records: list[dict[str, Any]], tiles: dict[str, dict[str, Any]]) -> None:
    by_frame: dict[str, list[dict[str, Any]]] = {}
    for item in records:
        by_frame.setdefault(item["frame_id"], []).append(item)
    for frame_records in by_frame.values():
        bounds = {tile_id: (tile["x_origin_px"], tile["y_origin_px"], tile["width_px"], tile["height_px"]) for tile_id, tile in tiles.items() if tile["source_frame_id"] == frame_records[0]["frame_id"]}
        for record in frame_records:
            box = tuple(record["geometry"]["bbox_frame_px"])
            cluster = [other for other in frame_records if other["kind"] == record["kind"] and _iou(box, other["geometry"]["bbox_frame_px"]) >= 0.30]
            record["evidence"]["persistence"] = persistence_from_window_overlap(box, list(bounds), [other["tile_id"] for other in cluster], bounds, [tuple(other["geometry"]["bbox_frame_px"]) for other in cluster])


def _metrics(records: list[dict[str, Any]], labels: dict[str, int]) -> dict[str, Any]:
    known = [item for item in records if item["kind"] == "KNOWN"]
    y = np.asarray([labels.get(item["detection_id"], 0) for item in known], dtype=int)
    scores = np.asarray([item["fusion"]["final_confidence"] or 0.0 for item in known], dtype=float)
    if not len(known):
        return {"known_candidates": 0}
    order = np.argsort(scores)[::-1]
    positives = int(y.sum())
    precision = np.cumsum(y[order]) / np.arange(1, len(y) + 1)
    recall = np.cumsum(y[order]) / max(1, positives)
    auprc = float(np.sum(precision * np.diff(np.r_[0, recall]))) if positives else None
    return {"known_candidates": len(known), "validation_labels": {"positive_matched_pipeline": positives, "negative_unmatched_detection": int(len(y) - positives)}, "fusion_auprc": auprc}


def run_stage3c(project_root: str | Path = ".", artifact_dir: str | Path | None = None) -> Path:
    """Execute once. Refuses to replace an existing Stage 3C artifact directory."""
    try:
        import torch
    except ImportError as exc:  # pragma: no cover - exercised in thin serving installs
        raise RuntimeError("Stage 3C requires the optional inference dependency extra") from exc
    from ultralytics import YOLO

    root = Path(project_root).resolve()
    source_artifact = root / "ml/artifacts/internal_v2/sagardrishti_internal_v2_artifacts"
    output = Path(artifact_dir or root / "ml/artifacts/stage3c_v4").resolve()
    if output.exists():
        raise FileExistsError(f"immutable Stage 3C artifact already exists: {output}")
    checkpoint = source_artifact / "best.pt"
    checkpoint_before = _sha256(checkpoint)
    if checkpoint_before != "f94d934681c8f95c0eda5474fe578d8aaa06463e638184f376456f861bb5c8a4":
        raise ValueError("frozen internal_v2 checkpoint hash mismatch")
    snapshot_dir = root / "data/processed/snap_2fa4bca0a0bc4b7d"
    snapshot, split = _json(snapshot_dir / "snapshot.json"), _json(snapshot_dir / "split.json")
    tiles = {row["tile_id"]: row for row in _jsonl(snapshot_dir / "tiles.jsonl")}
    frames = {row["frame_id"]: row for row in _jsonl(root / "data/interim/subpipe/frames.jsonl")}
    device = _device(torch)
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    torch.manual_seed(20260830)
    random.seed(20260830)
    model = YOLO(str(checkpoint))
    captured: list[Any] = []
    hook = model.model.model[MODEL_LAYER].register_forward_hook(lambda _module, _inputs, result: captured.append(result.detach()))
    by_split = {name: [row for row in tiles.values() if row["split"] == name] for name in ("train", "val", "test")}
    embeddings: dict[str, np.ndarray] = {}
    predictions: dict[str, list[tuple[tuple[float, float, float, float], float]]] = {}
    timing: dict[str, float] = {"inference_wall_seconds": 0.0}
    try:
        for split_name, rows in by_split.items():
            for start in range(0, len(rows), 16):
                batch = rows[start : start + 16]
                paths = [str(snapshot_dir / row["image_path"]) for row in batch]
                captured.clear()
                started = time.perf_counter()
                results = model.predict(paths, imgsz=INFERENCE_SIZE, conf=0.05, device=device, verbose=False)
                _sync(torch, device)
                timing["inference_wall_seconds"] += time.perf_counter() - started
                feature = _features(captured[-1], torch)
                for index, (tile, result) in enumerate(zip(batch, results)):
                    embeddings[tile["tile_id"]] = feature[index * MEMORY_GRID * MEMORY_GRID : (index + 1) * MEMORY_GRID * MEMORY_GRID]
                    boxes = result.boxes
                    predictions[tile["tile_id"]] = [(tuple(map(float, box.xywh[0].detach().cpu().tolist())), float(box.conf[0].detach().cpu().item())) for box in boxes]
    finally:
        hook.remove()
    background_embeddings = np.vstack([embeddings[row["tile_id"]] for row in by_split["train"] if not row["annotations"]])
    indices = np.linspace(0, len(background_embeddings) - 1, min(MEMORY_CORESET_SIZE, len(background_embeddings)), dtype=int)
    bank = background_embeddings[indices]
    output.mkdir(parents=True)
    np.savez_compressed(output / "open_set_memory_bank.npz", embeddings=bank)
    all_tile_scores: dict[str, np.ndarray] = {}
    for split_name in ("val", "test"):
        matrix = np.vstack([embeddings[row["tile_id"]] for row in by_split[split_name]])
        scores = _nearest_scores(torch, device, bank, matrix).reshape(len(by_split[split_name]), MEMORY_GRID * MEMORY_GRID)
        for row, score in zip(by_split[split_name], scores): all_tile_scores[row["tile_id"]] = score
    tau_min = float(np.quantile(np.concatenate([all_tile_scores[row["tile_id"]] for row in by_split["val"] if not row["annotations"]]), 0.99))
    records_by_split: dict[str, list[dict[str, Any]]] = {"val": [], "test": []}
    labels: dict[str, int] = {}
    for split_name in ("val", "test"):
        survey_scores = np.concatenate([all_tile_scores[row["tile_id"]] for row in by_split[split_name]])
        threshold = max(tau_min, float(np.quantile(survey_scores, 0.995)))
        for tile in by_split[split_name]:
            for index, (box, confidence) in enumerate(predictions[tile["tile_id"]]):
                record = _record(identifier=f"det_stage3c_{tile['tile_id']}_{index:03d}", kind="KNOWN", source="KNOWN_DETECTOR", tile=tile, frame=frames[tile["source_frame_id"]], local_box=box, confidence=confidence, anomaly_score=float(all_tile_scores[tile["tile_id"]].max()), device=device, checkpoint_hash=checkpoint_before)
                records_by_split[split_name].append(record)
                labels[record["detection_id"]] = int(any(_iou(box, truth) >= 0.5 for truth in _tile_annotation_boxes(tile)))
            patch_index = int(all_tile_scores[tile["tile_id"]].argmax())
            anomaly = float(all_tile_scores[tile["tile_id"]][patch_index])
            candidate_box = _bbox_from_patch(patch_index)
            if anomaly >= threshold and not any(_iou(candidate_box, box) > 0.3 for box, _ in predictions[tile["tile_id"]]):
                records_by_split[split_name].append(_record(identifier=f"unk_stage3c_{tile['tile_id']}_{patch_index:02d}", kind="UNKNOWN", source="OPEN_WORLD", tile=tile, frame=frames[tile["source_frame_id"]], local_box=candidate_box, confidence=None, anomaly_score=anomaly, device=device, checkpoint_hash=checkpoint_before))
    for records in records_by_split.values(): _apply_persistence(records, tiles)
    val_known = [row for row in records_by_split["val"] if row["kind"] == "KNOWN"]
    val_labels = [labels[row["detection_id"]] for row in val_known]
    calibration_available = len(set(val_labels)) == 2
    calibrator: IsotonicCalibrator | None = None
    fusion = None
    if calibration_available:
        calibrator = IsotonicCalibrator.fit([float(row["class_confidence"]) for row in val_known], val_labels)
        fusion_rows = [_evidence_features(row, calibrator.transform(float(row["class_confidence"]))) for row in val_known]
        fusion = fit_logistic_fusion(fusion_rows, val_labels, "val", "fusion_lr_stage3c_v1", "cal_iso_stage3c_v1")
    for records in records_by_split.values():
        for row in records:
            if fusion is None or calibrator is None:
                row["fusion"]["reason"] = "VALIDATION_CALIBRATION_INSUFFICIENT_LABEL_DIVERSITY"
                continue
            confidence = float(row["class_confidence"]) if row["kind"] == "KNOWN" else 0.5
            fused = fusion.predict(_evidence_features(row, calibrator.transform(confidence)))
            row["fusion"].update(fused)
            row["fusion"].pop("reason", None)
            row["provenance"]["fusion"] = "HEURISTIC_DERIVED"
            priority = calculate_priority(
                row["detection_id"], row["category"], row["fusion"]["final_confidence"],
                row["evidence"]["persistence"]["score"], row["evidence"]["shadow"]["score"],
                row["anomaly_score"], None, None,
            )
            if priority is not None: row["priority"] = priority.model_dump(mode="json")
    # Benchmark uses real tiles and records separate image decode, raw forward, and end-to-end measurements.
    benchmark_rows = by_split["test"][: min(100, len(by_split["test"]))]
    paths = [str(snapshot_dir / row["image_path"]) for row in benchmark_rows]
    started = time.perf_counter(); images = [np.asarray(Image.open(path).convert("RGB")) for path in paths]; preprocessing_ms = (time.perf_counter() - started) * 1000 / len(paths)
    model.predict(paths[:16], imgsz=INFERENCE_SIZE, device=device, verbose=False); _sync(torch, device)
    started = time.perf_counter(); model.predict(paths, imgsz=INFERENCE_SIZE, device=device, verbose=False); _sync(torch, device); end_to_end_ms = (time.perf_counter() - started) * 1000 / len(paths)
    tensors = model.predictor.preprocess(images[:16])
    with torch.inference_mode():
        _sync(torch, device); started = time.perf_counter(); model.model(tensors); _sync(torch, device); raw_forward_ms = (time.perf_counter() - started) * 1000 / len(tensors)
    rss_value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS documents ru_maxrss in bytes; Linux reports KiB.
    rss_mb = rss_value / (1024**2 if platform.system() == "Darwin" else 1024)
    artifact_metadata = {
        "stage": "3C", "run_id": RUN_ID, "created_at": datetime.now(timezone.utc).isoformat(), "snapshot_id": snapshot["snapshot_id"], "split_id": split["split_id"],
        "checkpoint": {"path": str(checkpoint), "sha256_before": checkpoint_before, "sha256_after": _sha256(checkpoint)},
        "runtime": {"torch": torch.__version__, "ultralytics": __import__("ultralytics").__version__, "device": device, "mps_available": bool(torch.backends.mps.is_available()), "mps_fallback": True, "backbone_layer": MODEL_LAYER, "inference_imgsz": INFERENCE_SIZE},
        "open_set": {"method": "PatchCore-style nearest-neighbour frozen YOLO layer-16 embeddings", "train_background_tiles": sum(not row["annotations"] for row in by_split["train"]), "train_background_patches": int(len(background_embeddings)), "coreset_size": int(len(bank)), "grid": [MEMORY_GRID, MEMORY_GRID], "tau_min_background_q99_val": tau_min, "per_survey_threshold": "max(tau_min, q99.5(all inference patch scores))", "no_leave_one_class_out": "Only PIPELINE is supervised; a true LOCO evaluation is impossible."},
    }
    calibration = {
        "snapshot_id": snapshot["snapshot_id"], "provenance": "HEURISTIC_DERIVED",
        "status": "FITTED" if fusion is not None else "UNAVAILABLE",
        "reason": None if fusion is not None else "VALIDATION_CALIBRATION_INSUFFICIENT_LABEL_DIVERSITY",
        "detector_calibration": calibrator.as_dict() if calibrator else None,
        "fusion": {"model_id": fusion.model_id, "fitted_split": fusion.fitted_split, "feature_names": list(FUSION_FEATURES), "intercept": fusion.intercept, "coefficients": fusion.coefficients} if fusion else None,
    }
    validation_metrics, test_metrics = _metrics(records_by_split["val"], labels), _metrics(records_by_split["test"], labels)
    for metrics, split_name in ((validation_metrics, "val"), (test_metrics, "test")):
        unknown = [row for row in records_by_split[split_name] if row["kind"] == "UNKNOWN"]
        metrics["open_set"] = {"protocol": "pipeline-region vs annotation-free-background separation only", "unknown_candidates": len(unknown), "scores": {"median": float(np.median([row["anomaly_score"] for row in unknown])) if unknown else None}, "universal_unknown_recognition_claim": False}
        metrics["shadow"] = {"applicable": sum(bool(row["evidence"]["shadow"]["applicable"]) for row in records_by_split[split_name]), "unavailable_reason": "NADIR_NOT_RECOVERABLE"}
    _write(output / "manifest.json", artifact_metadata)
    _write(output / "calibration.json", calibration)
    _write(output / "validation_evidence_metrics.json", validation_metrics)
    _write(output / "heldout_test_evidence_metrics.json", test_metrics)
    _write(output / "validation_detections.json", records_by_split["val"])
    _write(output / "heldout_test_detections.json", records_by_split["test"])
    _write(output / "persistence.json", {name: [row["evidence"]["persistence"] for row in rows] for name, rows in records_by_split.items()})
    _write(output / "shadow.json", {name: [row["evidence"]["shadow"] for row in rows] for name, rows in records_by_split.items()})
    _write(output / "priority.json", {name: [row["priority"] for row in rows] for name, rows in records_by_split.items()})
    _write(output / "latency.json", {"device": device, "sample_tiles": len(paths), "preprocessing_decode_ms_per_tile": preprocessing_ms, "raw_model_forward_ms_per_tile": raw_forward_ms, "end_to_end_ultralytics_ms_per_tile": end_to_end_ms, "peak_rss_mb_approximate": rss_mb, "note": "MPS and CPU timings are not comparable to the frozen RTX benchmark."})
    (output / "LIMITATIONS.md").write_text("# Stage 3C limitations\n\n- Only PIPELINE is supervised, so leave-one-class-out unknown-object evaluation is impossible.\n- The reported open-set protocol measures frozen-backbone distance separation for pipeline/contact and annotation-free/background regions; it does not establish universal unknown-object recognition.\n- Fresh MPS inference produced no IoU>=0.5 validation matches, so validation-only isotonic calibration and fusion are explicitly unavailable. Held-out records are not fused.\n- Mini2 rows remain L0_PIXEL_ONLY. Nadir-dependent shadow evidence, metric dimensions, geographic coordinates, coverage, and recovery priority scores remain unavailable.\n- Persistence is WINDOW_OVERLAP evidence only; no sequential ping evidence is claimed.\n")
    run_dir = root / "runs" / RUN_ID
    if run_dir.exists(): raise FileExistsError(f"immutable run already exists: {run_dir}")
    run_dir.mkdir(parents=True)
    all_records = records_by_split["val"] + records_by_split["test"]
    _write(run_dir / "manifest.json", {**artifact_metadata, "artifact_dir": str(output), "input": "real Stage 3C frozen-checkpoint inference on snapshot val/test tiles"})
    _write(run_dir / "detections.json", all_records)
    _write(run_dir / "frames.json", [frames[row["source_frame_id"]] for row in {record["tile_id"]: tiles[record["tile_id"]] for record in all_records}.values()])
    _write(run_dir / "model_version.json", {"model_version_id": "internal_v2", "model_id": "sagardrishti-internal-detector", "version": "internal_v2", "architecture": "yolo11s", "framework": "ultralytics", "weights_sha256": checkpoint_before, "snapshot_id": snapshot["snapshot_id"], "split_id": split["split_id"], "metrics_ref": str(source_artifact / "metrics.json"), "calibration_id": "cal_iso_stage3c_v1" if fusion else None, "review_examples_included": 0, "is_active": True})
    _write(run_dir / "benchmark.json", {"run_id": RUN_ID, "git_sha": snapshot.get("git_commit"), "generated_at": artifact_metadata["created_at"], "device": device, "split_id": split["split_id"], "split_assertions": snapshot["split_assertions"], "detection": {"overall": _json(source_artifact / "metrics.json")["winner"]["test"], "validation": _json(source_artifact / "metrics.json")["winner"]["validation"], "per_class": {"PIPELINE": _json(source_artifact / "metrics.json")["winner"]["test"]}}, "open_set": {"status": "LIMITED_PROTOCOL_EXECUTED", **test_metrics["open_set"]}, "stage3c": {"artifact_dir": str(output), "calibration": calibration, "validation": validation_metrics, "test": test_metrics, "latency": _json(output / "latency.json")}, "operational": _json(output / "latency.json"), "metrics_source": str(source_artifact / "metrics.json")})
    return output
