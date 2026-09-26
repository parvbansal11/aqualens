"""H0-4: harness inference runs the production detection path (spec H0 item 3, H0-AC4, I-H0-2, I-H0-3).

``infer_row`` calls ``FinalDetector.infer``, the path the service runs, on one frozen-manifest image, with the
SHIPWRECK recovery pass switched off (H0-3). The result keeps only the raw detector fields of each detection
(class id, class, raw confidence, box, tile); presentation fields (``display_*``, demo confidence, relabelling)
never enter it. Before running it checks that the detector is the frozen artifact, that recovery is off, and
that the source bytes match the manifest; after running it checks that the recovery path was never entered.
Ground truth never reaches inference: the row is read through a ground-truth-free view (I-H0-4).

A declared floor override (spec H0 item 3) lowers the production floors for calibration sweeps only; its value is
PID-05's decision, and it is recorded in the inference configuration.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Mapping

from round2.guards import GroundTruthFreeRow
from round2.manifest import DETECTOR_PATH, ManifestError, verified_detector_sha

from sagar.perception.runtime import (
    CLASSES, EXPECTED_SHA256, NMS_IOU_THRESHOLD, TILE_CONFIDENCE_FLOOR, TILE_OVERLAP, TILE_SIZE, FinalDetector,
)

# The raw detector output of one detection. Nothing else from a finding is scientific output.
RAW_DETECTION_FIELDS = ("raw_class_id", "raw_class", "raw_confidence", "bbox_px", "tile_id")
IDENTITY_FIELDS = ("image_id", "dataset", "sensor", "channel", "split", "survey_id", "bootstrap_group")


class ScientificPathError(ManifestError):
    """The inference would not be the frozen production path with recovery off."""


def scientific_detector(weights: Path = DETECTOR_PATH, *, floor_override: float | None = None) -> FinalDetector:
    """The frozen detector as every scientific path runs it: recovery off, production floors unless a sweep floor is declared."""
    return FinalDetector(weights, shipwreck_recovery=False, confidence_floor=floor_override)


def _check_detector(detector: FinalDetector) -> str:
    if detector.shipwreck_recovery is not False:
        raise ScientificPathError("the SHIPWRECK recovery pass must be switched off for scientific inference (I-H0-3)")
    digest = detector.checkpoint_digest()
    if digest != EXPECTED_SHA256 or digest != verified_detector_sha():
        raise ScientificPathError(f"detector SHA-256 {digest} is not the frozen detector (I-H0-2)")
    return digest


def inference_config(detector: FinalDetector) -> dict[str, Any]:
    """Everything about the detection path a scientific artifact must record."""
    digest = _check_detector(detector)
    override = detector.confidence_floor
    return {
        "detector_sha256": digest, "detector_path": str(detector.weights), "classes": dict(CLASSES),
        "shipwreck_recovery": detector.shipwreck_recovery, "floor_override": override,
        "floor_override_purpose": "calibration sweep (spec H0 item 3)" if override is not None else None,
        "floors": {"TILED": override if override is not None else TILE_CONFIDENCE_FLOOR,
                   "FULL_FRAME": override if override is not None else "ULTRALYTICS_DEFAULT"},
        "imgsz": 640, "tile_size": TILE_SIZE, "tile_overlap": TILE_OVERLAP, "nms_iou": NMS_IOU_THRESHOLD,
        "device": detector.device, "raw_detection_fields": list(RAW_DETECTION_FIELDS),
    }


def infer_row(detector: FinalDetector, row: Mapping[str, Any], corpus_root: Path) -> dict[str, Any]:
    """Raw production-path detections for one manifest image, with its identity and the inference configuration."""
    config = inference_config(detector)
    view = row if isinstance(row, GroundTruthFreeRow) else GroundTruthFreeRow(row)
    path = Path(corpus_root) / view["source_path"]
    if hashlib.sha256(path.read_bytes()).hexdigest() != view["source_sha256"]:
        raise ScientificPathError(f"source SHA-256 of {view['image_id']} does not match the manifest")
    before = detector.recovery_invocations
    meta, findings = detector.infer(path, view["survey_id"], view["image_id"])
    if detector.recovery_invocations != before or detector.recovery_invocations != 0:
        raise ScientificPathError("the SHIPWRECK recovery path was entered during scientific inference (I-H0-3)")
    if any(finding.get("candidate_recovery") for finding in findings):
        raise ScientificPathError("a recovery finding reached scientific inference (I-H0-3)")
    return {
        **{field: view.get(field) for field in IDENTITY_FIELDS},
        "inference_mode": meta["inference_mode"], "tile_count": meta["tile_count"],
        "width_px": meta["width_px"], "height_px": meta["height_px"],
        "detections": [{field: finding[field] for field in RAW_DETECTION_FIELDS} for finding in findings],
        "recovery_invocations": detector.recovery_invocations, "inference_config": config,
    }
