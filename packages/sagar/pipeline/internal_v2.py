"""Materialise auditable evidence for supplied internal_v2 held-out predictions.

This is intentionally not a training or inference script. It consumes the frozen checkpoint's
already-exported held-out prediction labels, retaining the checkpoint hash and source tile/frame
lineage. New inference is available only through ``FrozenDetectorArtifact.load_predictor``.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from sagar.core.models import Geometry
from sagar.evidence.persistence import persistence_from_window_overlap
from sagar.evidence.shadow import range_matched_shadow
from sagar.perception.detector import FrozenDetectorArtifact


RUN_ID = "run_internal_v2_evidence_v1"
SURVEY_ID = "survey_subpipe_mini2_internal_v2"


@dataclass(frozen=True)
class InternalV2Run:
    run_dir: Path
    run_id: str
    detection_count: int


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open() as handle:
        return [json.loads(line) for line in handle if line.strip()]


def _write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as handle:
        json.dump(value, handle, indent=2, sort_keys=True, default=str)
        handle.write("\n")


def _iou(one: tuple[float, float, float, float], two: tuple[float, float, float, float]) -> float:
    ax, ay, aw, ah = one
    bx, by, bw, bh = two
    inter = max(0.0, min(ax + aw, bx + bw) - max(ax, bx)) * max(0.0, min(ay + ah, by + bh) - max(ay, by))
    union = aw * ah + bw * bh - inter
    return inter / union if union else 0.0


def _prediction_rows(predictions_dir: Path, tiles: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for label_path in sorted((predictions_dir / "labels").glob("*.txt")):
        tile_id = label_path.stem
        tile = tiles.get(tile_id)
        if tile is None:
            raise ValueError(f"frozen held-out prediction references tile absent from snapshot: {tile_id}")
        for index, line in enumerate(label_path.read_text().splitlines()):
            values = line.split()
            if len(values) != 6 or values[0] != "0":
                raise ValueError(f"unsupported held-out prediction row: {label_path}:{index + 1}")
            _, xc, yc, width, height, confidence = map(float, values)
            local = ((xc - width / 2) * 512, (yc - height / 2) * 512, width * 512, height * 512)
            frame_box = (local[0] + tile["x_origin_px"], local[1] + tile["y_origin_px"], local[2], local[3])
            rows.append({"id": f"det_internal_v2_{tile_id}_{index:02d}", "tile": tile, "local_box": local, "frame_box": frame_box, "confidence": confidence})
    return rows


def materialize_internal_v2_run(
    artifact: FrozenDetectorArtifact,
    snapshot_dir: str | Path,
    frames_path: str | Path,
    output_root: str | Path = "runs",
) -> InternalV2Run:
    snapshot_dir, frames_path, output_root = Path(snapshot_dir), Path(frames_path), Path(output_root)
    run_dir = output_root / RUN_ID
    if run_dir.exists():
        raise FileExistsError(f"run output already exists and is immutable: {run_dir}")
    tiles = {row["tile_id"]: row for row in _read_jsonl(snapshot_dir / "tiles.jsonl")}
    frame_rows = {row["frame_id"]: row for row in _read_jsonl(frames_path)}
    selected_frames = {tile["source_frame_id"] for tile in tiles.values()}
    frame_rows = {key: value for key, value in frame_rows.items() if key in selected_frames}
    preprocessed: dict[str, dict[str, Any]] = {}
    for frame_id in frame_rows:
        path = Path("data/interim/subpipe/preprocess") / f"{frame_id}.json"
        if path.exists():
            preprocessed[frame_id] = json.loads(path.read_text())
    rows = _prediction_rows(artifact.artifact_dir / "heldout_predictions", tiles)
    by_frame: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_frame.setdefault(row["tile"]["source_frame_id"], []).append(row)
    detections: list[dict[str, Any]] = []
    for row in rows:
        frame_id = row["tile"]["source_frame_id"]
        frame = frame_rows[frame_id]
        geometry_data = preprocessed.get(frame_id, {}).get("geometry", frame["geometry"])
        geometry = Geometry(**geometry_data)
        bounds = {
            tile_id: (tile["x_origin_px"], tile["y_origin_px"], tile["width_px"], tile["height_px"])
            for tile_id, tile in tiles.items() if tile["source_frame_id"] == frame_id
        }
        cluster = [candidate for candidate in by_frame[frame_id] if _iou(row["frame_box"], candidate["frame_box"]) >= 0.30]
        persistence = persistence_from_window_overlap(row["frame_box"], list(bounds), [candidate["tile"]["tile_id"] for candidate in cluster], bounds)
        with Image.open(frame["source_path"]) as image:
            raw = np.asarray(image.convert("L"))
        shadow = range_matched_shadow(raw, row["frame_box"], geometry.nadir_offset_px, geometry.range_scale_m_per_px)
        context = {"applicable": False, "reason": "NADIR_NOT_RECOVERABLE" if geometry.nadir_offset_px is None else "FUSION_CONTEXT_NOT_CALIBRATED", "score": None, "background_z": None, "clutter_density": None}
        x, y, width, height = row["frame_box"]
        pics = {
            "ping_centre": None,
            "ping_span": None,
            "range_centre_m": None,
            "range_span_m": None,
            "range_unit": "PIXEL_RANGE",
            "side": "UNKNOWN" if geometry.nadir_offset_px is None else ("STARBOARD" if y >= geometry.nadir_offset_px else "PORT"),
            "along_centre_px": x + width / 2,
            "across_centre_px": y + height / 2,
            "reason": "PING_INDEX_NOT_RECOVERABLE" if geometry.ping_index_start is None else None,
        }
        detection = {
            "detection_id": row["id"], "run_id": RUN_ID, "survey_id": SURVEY_ID, "frame_id": frame_id,
            "tile_id": row["tile"]["tile_id"], "kind": "KNOWN", "source": "KNOWN_DETECTOR", "category": "PIPELINE",
            "class_confidence": row["confidence"], "label_certainty": "CERTAIN", "anomaly_score": None,
            "geometry": {"bbox_px": list(row["local_box"]), "bbox_frame_px": list(row["frame_box"]), "mask_rle": None, "pics": pics},
            "evidence": {"persistence": persistence, "shadow": shadow, "context": context, "completeness": ["persistence", "shadow", "context"]},
            "fusion": {"final_confidence": None, "contributions": {}, "intercept": None, "calibration_id": None, "fusion_model_id": None, "reason": "VALIDATION_CALIBRATION_ARTIFACT_NOT_AVAILABLE"},
            "dimensions": {"length_px": width, "width_px": height, "length_m": None, "width_m": None, "area_m2": None, "estimator": "NONE", "reason": "range_scale_m_per_px unknown"},
            "geo": {"lat": None, "lon": None, "position_uncertainty_m": None, "heading_deg": None, "provenance": "NONE", "nav_source": None, "spatial_reference_level": geometry.level.value, "reason": "WGS84 frame fix unavailable in Mini2 canonical data"},
            "model": {"model_version_id": "internal_v2", "model_id": "sagardrishti-internal-detector", "weights_sha256": artifact.weights_sha256, "confidence_at_prediction": row["confidence"], "device": artifact.metrics.get("device")},
            "review": {"latest_verdict": None, "review_count": 0, "reviewed_at": None, "reviewer": None}, "change_status": None,
            "priority": {"applicable": False, "reason": "METRIC_FOOTPRINT_UNAVAILABLE"},
            "provenance": {"class": "MODEL_DERIVED", "evidence": "HEURISTIC_DERIVED", "fusion": "NONE", "geo": "NONE", "review": "NONE"},
        }
        detections.append(detection)
    snapshot = json.loads((snapshot_dir / "snapshot.json").read_text())
    split = json.loads((snapshot_dir / "split.json").read_text())
    benchmark = {
        "run_id": RUN_ID, "git_sha": snapshot.get("git_commit"), "generated_at": datetime.now(timezone.utc).isoformat(),
        "device": artifact.metrics.get("device"), "split_id": split["split_id"], "split_assertions": snapshot["split_assertions"],
        "detection": {"overall": artifact.metrics["winner"]["test"], "per_class": {"PIPELINE": artifact.metrics["winner"]["test"]}, "validation": artifact.metrics["winner"]["validation"]},
        "open_set": {"status": "NOT_EVALUATED", "reason": "FROZEN_DETECTOR_BACKBONE_RUNTIME_UNAVAILABLE", "folds": []},
        "segmentation": {}, "operational": {"model_size_mb": artifact.metrics["winner"]["checkpoint_mb"], "latency_gpu": artifact.metrics.get("latency_gpu")}, "ablations": [],
        "metrics_source": str(artifact.metrics_path),
    }
    manifest = {
        "run_id": RUN_ID, "snapshot_id": artifact.metrics["dataset_snapshot_id"], "split_id": split["split_id"], "created_at": datetime.now(timezone.utc).isoformat(),
        "model_artifact": {"directory": str(artifact.artifact_dir), "best_pt_sha256": artifact.weights_sha256, "metrics_json": str(artifact.metrics_path)},
        "input": "frozen heldout_predictions labels only", "unknown_output": "NOT_MATERIALIZED: detector backbone embeddings unavailable", "fusion": "NOT_MATERIALIZED: validation calibration artifact unavailable",
    }
    _write(run_dir / "manifest.json", manifest)
    _write(run_dir / "detections.json", detections)
    _write(run_dir / "benchmark.json", benchmark)
    _write(run_dir / "model_version.json", artifact.model_version.model_dump(mode="json"))
    _write(run_dir / "frames.json", list(frame_rows.values()))
    return InternalV2Run(run_dir, RUN_ID, len(detections))
