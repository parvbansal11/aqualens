"""Stage 3B evidence and frozen-artifact integration checks."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from sagar.api import create_app
from sagar.evidence.persistence import wilson_lower_bound
from sagar.evidence.shadow import range_matched_shadow
from sagar.fusion import FUSION_FEATURES, fit_logistic_fusion
from sagar.perception import OpenSetMemoryBank, load_frozen_detector_artifact


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / "ml/artifacts/internal_v2/sagardrishti_internal_v2_artifacts"
RUN = ROOT / "runs/run_internal_v2_evidence_v1"


def test_frozen_internal_v2_has_expected_lineage_and_no_unknown_supervision() -> None:
    artifact = load_frozen_detector_artifact(ARTIFACT)
    assert artifact.weights_sha256 == "f94d934681c8f95c0eda5474fe578d8aaa06463e638184f376456f861bb5c8a4"
    assert artifact.metrics["dataset_snapshot_id"] == "snap_2fa4bca0a0bc4b7d"
    assert artifact.metrics["supervised_classes"] == ["PIPELINE"]
    rows = json.loads((RUN / "detections.json").read_text())
    assert rows
    assert all(row["kind"] == "KNOWN" and row["category"] == "PIPELINE" for row in rows)
    assert all(row["fusion"]["final_confidence"] is None for row in rows)


def test_open_set_bank_and_fusion_are_split_guarded() -> None:
    with pytest.raises(ValueError, match="train split"):
        OpenSetMemoryBank.from_train_background([np.array([1.0, 2.0])], "test", True)
    bank = OpenSetMemoryBank.from_train_background([np.array([1.0, 2.0]), np.array([2.0, 2.0])], "train", True)
    assert bank.score(np.array([[1.0, 2.0]])).item() == pytest.approx(0)
    rows = [dict.fromkeys(FUSION_FEATURES, 0.0), dict.fromkeys(FUSION_FEATURES, 1.0)]
    with pytest.raises(ValueError, match="validation-only"):
        fit_logistic_fusion(rows, [0, 1], "test", "fusion", "cal")
    fitted = fit_logistic_fusion(rows, [0, 1], "val", "fusion", "cal", iterations=5)
    assert set(fitted.predict(dict.fromkeys(FUSION_FEATURES, 0.0))["contributions"]) == set(FUSION_FEATURES)


def test_shadow_and_persistence_do_not_invent_geometry() -> None:
    unavailable = range_matched_shadow(np.ones((32, 32), dtype=np.uint8), (2, 2, 8, 8), None, None)
    assert unavailable["applicable"] is False
    assert unavailable["reason"] == "NADIR_NOT_RECOVERABLE"
    assert unavailable["score"] is None
    assert wilson_lower_bound(1, 1) < wilson_lower_bound(8, 8)


def test_api_serves_real_run_and_keeps_test_review_training_ineligible(tmp_path: Path) -> None:
    client = TestClient(create_app(ROOT))
    assert client.get("/api/v1/health").status_code == 200
    benchmark = client.get("/api/v1/benchmarks").json()
    assert benchmark["detection"]["overall"]["map50"] == pytest.approx(0.28149612224318105)
    survey = client.get("/api/v1/missions").json()[0]["surveys"][0]
    payload = client.get(f"/api/v1/surveys/{survey['survey_id']}/detections?limit=1").json()
    detection = payload["items"][0]
    assert detection["class_confidence"] is not None
    review = client.post(f"/api/v1/detections/{detection['detection_id']}/reviews", json={"verdict": "CONFIRMED", "reviewer": "test_operator"})
    assert review.status_code == 200
    assert review.json()["training_eligible"] is False
    assert review.json()["training_eligible_reason"] == "EVALUATION_SPLIT"


def test_api_upload_and_report_contracts_are_honest() -> None:
    client = TestClient(create_app(ROOT))
    upload = client.post("/api/v1/surveys/upload", files={"file": ("sonar.png", b"real-bytes", "image/png")})
    # Bytes that are not a readable raster are a rejected upload, not a failed
    # processing run: the two states mean different things to an operator and
    # the API keeps them apart. No job and no survey are created.
    assert upload.status_code == 422
    error = upload.json()["error"]
    assert error["code"] == "UNREADABLE_RASTER"
    assert "sonar.png" in error["message"]
    report = client.get("/api/v1/surveys/survey_subpipe_mini2_internal_v2/report?format=csv")
    assert report.status_code == 200
    assert "anomaly_score" in report.text.splitlines()[0]
