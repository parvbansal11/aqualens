"""H0-8: the first runtime-path detector baseline (spec H0 required experiment, §7.1, §7.3; PID-05, PID-06).

- Runtime-floor detections are the production path's own: H0-5's same-pass records (hash-verified), produced by the
  frozen detector with recovery off at the production floors (tiled 0.12; full frame Ultralytics' implicit 0.25).
- A second run at the PID-05 sweep floor 0.001 is cached, label-free, for later threshold sweeps. The effective floor
  and Ultralytics' max_det are recorded, and every detector pass that returned max_det boxes is counted as saturated.
  Filtering the sweep cache at the production floors is checked against the runtime detections.
- Metrics are computed on test only (§7.1 as locked), per dataset × sensor × class × IoU with PID-06 matching,
  cluster-bootstrap percentile CIs over the frozen bootstrap groups (§7.3) and Clopper–Pearson alongside.
- AI4 is FRAGMENT-LEVEL (object level UNAVAILABLE pending PID-01). PING's primary population is the PID-03
  one-per-parent subset; all variants are a SENSITIVITY population. Val is cached for fitting, never scored.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

import numpy as np
import torch

from round2.evaluation import (
    IOU_THRESHOLDS, MATCHING_METHOD, MIN_EVENTS_FOR_CLAIMS, class_counts, clopper_pearson, cluster_bootstrap, match_image,
)
from round2.features import _grid_origins
from round2.guards import FROZEN_MANIFEST_SHA256, GroundTruthFreeRow, load_frozen_manifest, rows_for
from round2.infer import IDENTITY_FIELDS, ScientificPathError, inference_config, infer_row, scientific_detector
from round2.manifest import DETECTOR_METRICS, REPO

from sagar.perception.runtime import TILE_CONFIDENCE_FLOOR, FinalDetector

SWEEP_FLOOR = 0.001                  # PID-05
try:
    from ultralytics.cfg import DEFAULT_CFG
    MAX_DET = int(DEFAULT_CFG.max_det)   # Ultralytics' default; the runtime does not override it
except Exception:  # noqa: BLE001
    MAX_DET = 300
H0_5_RECORDS = REPO / "artifacts/round2/H0/cells/iter-1/records.jsonl"
H0_5_RECORDS_SHA256 = "23a80945a16bbef9a8ed913681db9fd54484a2f4bed0f28a8ed8610acea73b13"   # frozen H0-5 records.jsonl
H0_5_CACHE_MANIFEST = REPO / "artifacts/round2/H0/cells/iter-1/cache_manifest.json"
H0_7_SUBSET = REPO / "artifacts/round2/H0/ping_one_per_parent/iter-1/ping_one_per_parent.jsonl"
BOOTSTRAP_B = 1000                   # spec §7.3: B ≥ 1,000
BOOTSTRAP_SEED = 26057               # recorded; any fixed seed is admissible
FULL_FRAME_FLOOR = 0.25              # Ultralytics 8.4.135 predict default (the runtime passes no conf); recorded, not set here


class BaselineError(ScientificPathError):
    """H0-8 cannot run as locked."""


def sweep_infer_row(detector: FinalDetector, row: Mapping[str, Any], corpus_root: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """H0-4 inference at the sweep floor, plus the raw box count of each detector pass and whether it hit max_det."""
    if detector.confidence_floor != SWEEP_FLOOR:
        raise BaselineError(f"the sweep run must use the PID-05 floor {SWEEP_FLOOR}, not {detector.confidence_floor}")
    detector.load()
    model, counts = detector.model, []
    shadowed, original = "predict" in vars(model), model.predict

    def predict(**kwargs):
        output = original(**kwargs)
        boxes = output[0].boxes
        counts.append(0 if boxes is None else len(boxes))
        return output

    model.predict = predict
    try:
        result = infer_row(detector, row, corpus_root)
    finally:
        if shadowed:
            model.predict = original
        else:
            del model.predict
    grids = _grid_origins(result["inference_mode"], result["width_px"], result["height_px"])
    if len(counts) != len(grids):
        raise BaselineError(f"{len(counts)} detector passes for {len(grids)} expected on {row['image_id']}")
    passes = [{"tile_id": tile_id, "raw_boxes": n, "saturated": n >= MAX_DET} for (tile_id, *_), n in zip(grids, counts)]
    return result, passes


def populations(test_rows: list[Mapping[str, Any]], ping_representatives: list[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    """The H0-8 evaluation populations. Only test rows are accepted (§7.1 as locked)."""
    if any(row["split"] != "test" for row in test_rows):
        raise BaselineError("H0-8 evaluates test rows only; val is a fitting cache")
    by_dataset: dict[str, list[Mapping[str, Any]]] = {}
    for row in sorted(test_rows, key=lambda row: row["image_id"]):
        by_dataset.setdefault(row["dataset"], []).append(row)
    pops: dict[str, dict[str, Any]] = {}
    subpipe = by_dataset.get("SUBPIPE", [])
    if subpipe:
        pops["SUBPIPE|Klein 3500|ALL_TEST"] = {"rows": subpipe, "role": "PRIMARY", "evaluation_level": "BOX"}
        for channel in ("HF", "LF"):
            chosen = [row for row in subpipe if row["channel"] == channel]
            if chosen:
                pops[f"SUBPIPE|Klein 3500|{channel}"] = {"rows": chosen, "role": "CHANNEL_BREAKDOWN", "evaluation_level": "BOX"}
    if by_dataset.get("AI4SHIPWRECKS"):
        pops["AI4SHIPWRECKS|EdgeTech 2205|FRAGMENT_LEVEL"] = {
            "rows": by_dataset["AI4SHIPWRECKS"], "role": "PRIMARY", "evaluation_level": "FRAGMENT_LEVEL",
            "note": "GT = connected-component fragment boxes (PID-01 open); these are not wreck objects"}
    ping = by_dataset.get("PING_GHOSTVISION", [])
    if ping:
        chosen_ids = {rep["image_id"] for rep in ping_representatives if rep["split"] == "test"}
        primary = [row for row in ping if row["image_id"] in chosen_ids]
        if len(primary) != len(chosen_ids):
            raise BaselineError("a PING representative is missing from the test rows")
        pops["PING_GHOSTVISION|Humminbird|PRIMARY_ONE_PER_PARENT"] = {
            "rows": primary, "role": "PRIMARY", "evaluation_level": "BOX", "note": "PID-03 one image per augmentation parent"}
        pops["PING_GHOSTVISION|Humminbird|SENSITIVITY_ALL_VARIANTS"] = {
            "rows": ping, "role": "SENSITIVITY", "evaluation_level": "BOX",
            "note": "all augmentation variants; siblings are not independent physical observations"}
    return pops


def evaluate_population(pop: Mapping[str, Any], detections_by_image: Mapping[str, list[Mapping[str, Any]]], *, b: int = BOOTSTRAP_B,
                        seed: int = BOOTSTRAP_SEED) -> dict[str, Any]:
    """Per IoU threshold and class: TP, detections, GT, precision and recall with bootstrap and Clopper–Pearson CIs."""
    rows = pop["rows"]
    result: dict[str, Any] = {"images": len(rows), "bootstrap_groups": len({row["bootstrap_group"] for row in rows}),
                              "role": pop["role"], "evaluation_level": pop["evaluation_level"], "note": pop.get("note"), "by_iou": {}}
    for tau in sorted(IOU_THRESHOLDS.values(), reverse=True):
        per_image = []
        for row in rows:
            detections = [{"raw_class": d["raw_class"], "raw_confidence": d["raw_confidence"], "bbox_px": d["bbox_px"]}
                          for d in detections_by_image[row["image_id"]]]
            per_image.append((row["bootstrap_group"], class_counts(detections, row["gt_boxes"], tau)))
        classes = sorted({cls for _, counts in per_image for cls in counts})
        table = {}
        for cls in classes:
            units_p = [{"group": g, "num": c.get(cls, {}).get("tp", 0), "den": c.get(cls, {}).get("detections", 0)} for g, c in per_image]
            units_r = [{"group": g, "num": c.get(cls, {}).get("tp", 0), "den": c.get(cls, {}).get("gt", 0)} for g, c in per_image]
            tp = sum(u["num"] for u in units_p)
            detections, gt = sum(u["den"] for u in units_p), sum(u["den"] for u in units_r)
            precision = cluster_bootstrap(units_p, b=b, seed=seed)
            recall = cluster_bootstrap(units_r, b=b, seed=seed)
            for stat, n in ((precision, detections), (recall, gt)):
                stat["clopper_pearson"] = list(clopper_pearson(tp, n))
                stat["for_claims"] = n >= MIN_EVENTS_FOR_CLAIMS
            table[cls] = {"tp": tp, "detections": detections, "gt": gt, "fp": detections - tp, "fn": gt - tp,
                          "precision": precision, "recall": recall}
        result["by_iou"][str(tau)] = table
    return result


def _sha(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    with Path(path).open() as handle:
        return [json.loads(line) for line in handle if line.strip()]


def _detection_key(detection: Mapping[str, Any]) -> tuple:
    return (detection["raw_class"], detection["raw_confidence"], tuple(detection["bbox_px"]), detection["tile_id"])


def _markdown(metrics: Mapping[str, Any]) -> str:
    lines = ["# H0-8 runtime-path detector baseline (test only)", "",
             "Runtime-path metrics: the deployed tiled/full-frame path at production floors, recovery off, PID-06 matching.",
             "AI4 is FRAGMENT-LEVEL (GT = mask fragments; not wreck objects). AI4 object-level metrics: UNAVAILABLE_PENDING_PID_01.",
             "PING primary = one image per augmentation parent (n = 324); all variants = SENSITIVITY only.",
             "Rates with fewer than 30 events are reported but not for claims (spec §7.8). null = undefined, never 0.", ""]
    fmt = lambda x: "null" if x is None else f"{x:.3f}"  # noqa: E731
    for name, pop in metrics["populations"].items():
        lines += [f"## {name} ({pop['role']}, {pop['evaluation_level']}; {pop['images']} images, {pop['bootstrap_groups']} bootstrap groups)", ""]
        for tau, table in pop["by_iou"].items():
            lines += [f"IoU {tau}{' (primary)' if tau == '0.5' else ' (secondary)'}", "",
                      "| class | TP | detections | GT | precision [95 % bootstrap] | precision for claims | recall [95 % bootstrap] | recall for claims |",
                      "|---|---|---|---|---|---|---|---|"]
            claim = lambda stat, n: "yes" if stat["for_claims"] else f"no (n = {n} < 30)"  # noqa: E731
            for cls, row in table.items():
                p, r = row["precision"], row["recall"]
                lines.append(f"| {cls} | {row['tp']} | {row['detections']} | {row['gt']} | {fmt(p['point'])} [{fmt(p['ci_low'])}, {fmt(p['ci_high'])}] | "
                             f"{claim(p, row['detections'])} | {fmt(r['point'])} [{fmt(r['ci_low'])}, {fmt(r['ci_high'])}] | {claim(r, row['gt'])} |")
            lines.append("")
    lines += ["## Training-representation metrics (for labelled comparison only)", "",
              "From the frozen detector's metrics.json: Kaggle tile representation, Ultralytics validation; not the runtime path.", ""]
    for cls, row in metrics["training_representation"]["heldout_test_per_class"].items():
        lines.append(f"- {cls}: precision {row['precision']:.3f}, recall {row['recall']:.3f}, AP50 {row['ap50']:.3f}")
    return "\n".join(lines) + "\n"


def write_baseline(out_dir: Path, *, corpus_root: Path, detector: FinalDetector | None = None,
                   manifest_rows: list[dict[str, Any]] | None = None, ping_representatives: list[dict[str, Any]] | None = None,
                   runtime_records_path: Path = H0_5_RECORDS, runtime_records_sha256: str | None = None,
                   manifest_sha256: str = FROZEN_MANIFEST_SHA256, bootstrap_b: int = BOOTSTRAP_B, seed: int = BOOTSTRAP_SEED,
                   argv: list[str] | None = None) -> dict[str, Any]:
    out_dir = Path(out_dir)
    partial = out_dir.with_name(out_dir.name + ".partial")
    if (out_dir.exists() and any(out_dir.iterdir())) or partial.exists():
        raise BaselineError(f"{out_dir} (or its .partial) already exists; artifacts are immutable, use a new iteration")
    started = datetime.now(timezone.utc).isoformat()
    manifest_rows = load_frozen_manifest() if manifest_rows is None else manifest_rows
    subset_sha = None
    if ping_representatives is None:
        ping_representatives, subset_sha = _load_jsonl(H0_7_SUBSET), _sha(H0_7_SUBSET)
    if runtime_records_sha256 is not None and _sha(runtime_records_path) != runtime_records_sha256:
        raise BaselineError("the runtime-floor records are not the frozen H0-5 records")
    if runtime_records_path == H0_5_RECORDS:
        h0_5 = json.loads(H0_5_CACHE_MANIFEST.read_text())["inference_config"]
        if h0_5["shipwreck_recovery"] is not False or h0_5["floor_override"] is not None or h0_5["detector_sha256"] != inference_config(scientific_detector())["detector_sha256"]:
            raise BaselineError("the H0-5 records were not produced by the frozen production path with recovery off")
    runtime_by_image = {record["image_id"]: record for record in _load_jsonl(runtime_records_path)}
    detector = scientific_detector(floor_override=SWEEP_FLOOR) if detector is None else detector
    config = inference_config(detector)
    val_rows = sorted(rows_for(manifest_rows, "val", "fit"), key=lambda row: row["image_id"])
    test_rows = sorted(rows_for(manifest_rows, "test", "evaluate"), key=lambda row: row["image_id"])
    missing = [row["image_id"] for row in val_rows + test_rows if row["image_id"] not in runtime_by_image]
    if missing:
        raise BaselineError(f"{len(missing)} val/test images have no runtime-floor record")

    (partial / "sweep").mkdir(parents=True)
    try:
        saturated = passes_total = differing = 0
        saturation_by_dataset: dict[str, list[int]] = {}
        for split, rows in (("val", val_rows), ("test", test_rows)):
            with (partial / "sweep" / f"{split}.jsonl").open("w") as handle:
                for row in rows:
                    result, passes = sweep_infer_row(detector, GroundTruthFreeRow(row), corpus_root)
                    if result.pop("inference_config") != config:
                        raise BaselineError("the inference configuration changed during the sweep run")
                    hits = sum(p["saturated"] for p in passes)
                    saturated += hits
                    passes_total += len(passes)
                    entry = saturation_by_dataset.setdefault(f"{row['dataset']}|{split}", [0, 0])
                    entry[0] += hits
                    entry[1] += len(passes)
                    floor = TILE_CONFIDENCE_FLOOR if result["inference_mode"] == "TILED" else FULL_FRAME_FLOOR
                    filtered = sorted(_detection_key(d) for d in result["detections"] if d["raw_confidence"] > floor)
                    runtime = sorted(_detection_key(d) for d in runtime_by_image[row["image_id"]]["detections"])
                    differing += filtered != runtime
                    handle.write(json.dumps({**result, "passes": passes, "confidence_floor": SWEEP_FLOOR, "max_det": MAX_DET}, sort_keys=True) + "\n")
        if detector.recovery_invocations != 0:
            raise BaselineError("the SHIPWRECK recovery path was entered during H0-8")

        detections_by_image = {row["image_id"]: runtime_by_image[row["image_id"]]["detections"] for row in test_rows}
        pops = populations(test_rows, ping_representatives)
        metrics = {"populations": {name: evaluate_population(pop, detections_by_image, b=bootstrap_b, seed=seed) for name, pop in pops.items()},
                   "ai4_object_level": {"status": "UNAVAILABLE_PENDING_PID_01"},
                   "training_representation": {"source": str(DETECTOR_METRICS.relative_to(REPO)),
                                               "label": "TRAINING_REPRESENTATION (Kaggle tile representation, Ultralytics validation); not the runtime path",
                                               "heldout_test_per_class": json.loads(DETECTOR_METRICS.read_text())["winner"]["heldout_test_per_class"]}}
        (partial / "metrics.json").write_text(json.dumps(metrics, indent=2, sort_keys=True) + "\n")
        (partial / "metrics.md").write_text(_markdown(metrics))
        with (partial / "test_match_labels.jsonl").open("w") as handle:
            for row in test_rows:
                detections = detections_by_image[row["image_id"]]
                labels = {str(tau): match_image(detections, row["gt_boxes"], tau)[0] for tau in sorted(IOU_THRESHOLDS.values(), reverse=True)}
                handle.write(json.dumps({"image_id": row["image_id"], "split": "test", "tp_by_iou": labels}, sort_keys=True) + "\n")

        import PIL
        import ultralytics
        git = lambda *args: subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True).stdout.strip()  # noqa: E731
        provenance = {
            "ticket": "H0-8", "artifact": "runtime-path detector baseline", "iteration": out_dir.name,
            "git_sha": git("rev-parse", "HEAD"), "git_dirty": bool(git("status", "--porcelain")),
            "harness_source_sha256": {name: _sha(Path(__file__).parent / name) for name in
                                      ("__init__.py", "manifest.py", "guards.py", "infer.py", "features.py", "evaluation.py", "baseline.py")},
            "source_manifest_sha256": manifest_sha256, "ping_subset_sha256": subset_sha,
            "runtime_records": str(runtime_records_path), "runtime_records_sha256": _sha(runtime_records_path),
            "corpus_root": str(corpus_root), "detector_model_id": "sagardrishti_multidomain_v1_1_yolo11s",
            "detector_sha256": config["detector_sha256"], "inference_config": config, "shipwreck_recovery": False,
            "recovery_invocations": detector.recovery_invocations,
            "production_floors": {"TILED": TILE_CONFIDENCE_FLOOR, "FULL_FRAME": "ULTRALYTICS_DEFAULT (0.25 at ultralytics 8.4.135)"},
            "sweep": {"confidence_floor": SWEEP_FLOOR, "max_det": MAX_DET, "passes": passes_total, "saturated_passes": saturated,
                      "saturation_rate": saturated / passes_total if passes_total else None,
                      "saturation_by_dataset_split": {k: {"saturated": v[0], "passes": v[1]} for k, v in sorted(saturation_by_dataset.items())}},
            "sweep_consistency": {"images_checked": len(val_rows) + len(test_rows), "images_where_filtered_sweep_differs_from_runtime": differing,
                                  "rule": "sweep detections with raw_confidence > the production floor of their mode vs the runtime-floor detections"},
            "matching_method": MATCHING_METHOD, "iou_thresholds": IOU_THRESHOLDS,
            "bootstrap": {"b": bootstrap_b, "seed": seed, "unit": "frozen manifest bootstrap_group", "interval": "percentile 95 %",
                          "also": "Clopper–Pearson 95 % on pooled counts"},
            "evaluated_split": "test", "val_use": "sweep cache only (fitting); never scored (§7.1 as locked)",
            "ai4": {"fragment_level": "AVAILABLE", "object_level": "UNAVAILABLE_PENDING_PID_01"},
            "ping": {"primary": "PID-03 one-per-parent representatives", "sensitivity": "all variants"},
            "populations": {name: {"images": len(pop["rows"]), "role": pop["role"], "evaluation_level": pop["evaluation_level"]} for name, pop in pops.items()},
            "figures": "none (no figure is defined by the spec or ticket)",
            "versions": {"python": platform.python_version(), "numpy": np.__version__, "torch": torch.__version__,
                         "ultralytics": ultralytics.__version__, "pillow": PIL.__version__, "machine": platform.platform()},
            "command": argv if argv is not None else ["PYTHONPATH=packages:ml", "python", "-m", "round2.baseline", *sys.argv[1:]],
            "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(),
            "outputs": ["metrics.json", "metrics.md", "test_match_labels.jsonl", "sweep/val.jsonl", "sweep/test.jsonl"],
        }
        (partial / "artifact_manifest.json").write_text(json.dumps(provenance, indent=2) + "\n")
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    if out_dir.exists():
        out_dir.rmdir()
    partial.rename(out_dir)
    return provenance


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=REPO / "artifacts/round2/H0/runtime_path_baseline/iter-1")
    args = parser.parse_args()
    provenance = write_baseline(args.out, corpus_root=args.corpus_root, runtime_records_sha256=H0_5_RECORDS_SHA256)
    print(json.dumps({k: provenance[k] for k in ("sweep", "sweep_consistency", "recovery_invocations", "populations")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
