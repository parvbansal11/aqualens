#!/usr/bin/env python3
"""Create evidence/run records from the immutable internal_v2 artifact."""
from __future__ import annotations

from pathlib import Path

from sagar.perception.detector import load_frozen_detector_artifact
from sagar.pipeline.internal_v2 import materialize_internal_v2_run


ROOT = Path(__file__).resolve().parents[1]
artifact = load_frozen_detector_artifact(ROOT / "ml/artifacts/internal_v2/sagardrishti_internal_v2_artifacts")
run = materialize_internal_v2_run(artifact, ROOT / "data/processed/snap_2fa4bca0a0bc4b7d", ROOT / "data/interim/subpipe/frames.jsonl", ROOT / "runs")
print(f"Materialized {run.detection_count} frozen held-out detections at {run.run_dir}")
