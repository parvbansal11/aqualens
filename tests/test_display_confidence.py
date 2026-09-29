"""Product display confidence: the historical SagarDrishti mapping, applied globally, never to science.

Product Contacts carry ``machine.raw_detector_score`` (the frozen detector's score, unchanged) and
``machine.display_confidence`` (DEMO_BOUNDED_SIGMOID_V1 over CONTACT_EVIDENCE_FUSION_V1). Scientific
and evaluation code reads raw scores only.
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sagar.api import create_app
from sagar.api.product import display_confidence_fields
from sagar.perception.runtime import FinalDetector
from sagar.vnext import DemoConfidenceNormalizationPolicy, fuse_contact_confidence, normalize_demo_confidence

ROOT = Path(__file__).resolve().parents[1]
GRID = [i / 200 for i in range(201)]


def historical(x: float) -> float:
    """The mapping as written in the SagarDrishti codebase (DEMO_BOUNDED_SIGMOID_V1)."""
    return 0.70 + 0.20 / (1.0 + math.exp(-28.0 * (x - 0.3139777305538386)))


def test_historical_mapping_is_used():
    policy = DemoConfidenceNormalizationPolicy()
    assert (policy.version, policy.lower, policy.upper, policy.steepness, policy.reference_center) == (
        "DEMO_BOUNDED_SIGMOID_V1", .70, .90, 28.0, .3139777305538386)
    for raw in GRID:
        fields = display_confidence_fields({"max_raw_confidence": raw})
        fused = fuse_contact_confidence({"max_raw_confidence": raw})["raw_fused_confidence"]
        assert fields["raw_fused_confidence"] == pytest.approx(fused)
        assert fields["display_confidence"] == pytest.approx(normalize_demo_confidence(fused))
        assert fields["display_confidence"] == pytest.approx(historical(fused))
        assert fields["display_confidence_method"] == "DEMO_BOUNDED_SIGMOID_V1 over CONTACT_EVIDENCE_FUSION_V1"


def test_deterministic_monotonic_and_bounded():
    values = [display_confidence_fields({"max_raw_confidence": raw})["display_confidence"] for raw in GRID]
    assert values == [display_confidence_fields({"max_raw_confidence": raw})["display_confidence"] for raw in GRID]
    assert all(b >= a for a, b in zip(values, values[1:]))
    assert all(0.70 <= v <= 0.90 for v in values)


def test_runtime_value_is_reused_not_recomputed():
    runtime = {"max_raw_confidence": 0.18, "raw_fused_confidence": 0.2559, "normalized_confidence": 0.7329,
               "confidence_normalization": "DEMO_BOUNDED_SIGMOID_V1", "confidence_method": "CONTACT_EVIDENCE_FUSION_V1"}
    assert display_confidence_fields(runtime) == {"display_confidence": 0.7329, "raw_fused_confidence": 0.2559,
        "display_confidence_method": "DEMO_BOUNDED_SIGMOID_V1 over CONTACT_EVIDENCE_FUSION_V1"}


@pytest.fixture()
def client(monkeypatch, tmp_path):
    from test_runtime_api_resilience import _fake_infer
    monkeypatch.setattr(FinalDetector, "infer", _fake_infer)
    monkeypatch.setattr(FinalDetector, "load", lambda self: None)
    monkeypatch.setenv("SAGARDRISHTI_RUNTIME_DIR", str(tmp_path / "runtime"))
    return TestClient(create_app(ROOT))


def _upload(client):
    from test_runtime_api_resilience import _await, _png_bytes
    mission = client.post("/api/v1/missions", json={"name": "Confidence"}).json()["mission_id"]
    accepted = client.post(f"/api/v1/missions/{mission}/uploads", files={"file": ("sonar.png", _png_bytes(), "image/png")}).json()
    assert _await(client, accepted["job_id"])["state"] == "COMPLETED"
    return mission


def test_real_survey_contacts_expose_raw_and_display(client):
    mission = _upload(client)
    contacts = client.get(f"/api/v1/missions/{mission}/contacts").json()["items"]
    assert contacts
    for contact in contacts:
        machine = contact["machine"]
        assert machine["raw_detector_score"] == .42  # the detector's own score, unchanged
        assert 0.70 <= machine["display_confidence"] <= 0.90
        assert machine["display_confidence_method"] == "DEMO_BOUNDED_SIGMOID_V1 over CONTACT_EVIDENCE_FUSION_V1"
        assert contact["evidence"]["detector"]["values"]["raw_detector_score"] == .42
        detail = client.get(f"/api/v1/contacts/{contact['contact_id']}").json()["machine"]
        assert detail["raw_detector_score"] == .42 and detail["display_confidence"] == machine["display_confidence"]
        for key in ("calibrated_probability", "posterior_probability"):
            assert key not in str(contact)
    report = client.post(f"/api/v1/missions/{mission}/reports").json()
    assert {c["machine"]["raw_detector_score"] for c in report["contacts"]} == {.42}
    assert all(0.70 <= c["machine"]["display_confidence"] <= 0.90 for c in report["contacts"])


def test_runtime_findings_keep_raw_detector_confidence(client):
    """The inference record (what evaluation reads) is untouched by product presentation."""
    mission = _upload(client)
    survey = client.get(f"/api/v1/missions/{mission}/surveys").json()["items"][0]
    runtime = client.get(f"/api/v1/runtime/surveys/{survey['runtime_ref']}").json()
    assert {f["raw_confidence"] for f in runtime["findings"]} == {.42}
    assert all("display_confidence" not in c or c.get("display_confidence") is None for c in runtime["contacts"])


def test_demo_contacts_use_the_same_logic(client, monkeypatch):
    monkeypatch.setenv("AQUALENS_DEMO_MODE", "1")
    assert client.post("/api/v1/demo/seed").status_code in (200, 201)
    items = client.get("/api/v1/missions/demo_mission_arabian_sea_07/contacts").json()["items"]
    known = [c for c in items if c["machine"]]
    assert known
    for contact in known:
        raw = contact["machine"]["raw_detector_score"]
        assert contact["machine"]["display_confidence"] == pytest.approx(display_confidence_fields({"max_raw_confidence": raw})["display_confidence"])
        assert 0.70 <= contact["machine"]["display_confidence"] <= 0.90


def test_contacts_stored_before_display_confidence_are_backfilled_once(client, tmp_path):
    import json, sqlite3
    mission = _upload(client)
    db = sqlite3.connect(tmp_path / "runtime" / "reviews.sqlite3")
    (identifier, payload), = db.execute("SELECT id, payload FROM product_records WHERE kind='contact' AND mission_id=?", (mission,)).fetchall()
    contact = json.loads(payload)
    expected = contact["machine"]["display_confidence"]
    for key in ("display_confidence", "raw_fused_confidence", "display_confidence_method"):
        contact["machine"].pop(key)
    db.execute("UPDATE product_records SET payload=? WHERE id=?", (json.dumps(contact), identifier))
    db.commit()
    restarted = TestClient(create_app(ROOT))
    machine = restarted.get(f"/api/v1/contacts/{identifier}").json()["machine"]
    assert machine["display_confidence"] == pytest.approx(expected)  # the run's own value, restored
    assert machine["raw_detector_score"] == .42
    again = TestClient(create_app(ROOT)).get(f"/api/v1/contacts/{identifier}").json()["machine"]
    assert again == machine


def test_scientific_harness_reads_raw_scores_only():
    for path in (ROOT / "ml" / "round2").glob("*.py"):
        source = path.read_text()
        for name in ("display_confidence", "normalized_confidence", "normalize_demo_confidence", "raw_fused_confidence"):
            assert name not in source, f"{path.name} must not read {name}"
    assert "raw_confidence" in (ROOT / "ml" / "round2" / "baseline.py").read_text()


@pytest.mark.parametrize("path, sha256", [
    ("ml/artifacts/final_v1/detector/metrics.json", "c58d0d05d0b0c32059887939c6d6dc0badc737cb4338739adb20caece127b7b1"),
    ("artifacts/round2/H0/runtime_path_baseline/iter-2/metrics.json", "55029b7d3d9f72193062c04781a07c471de223b50051b37244e4c850876eb835"),
])
def test_frozen_evaluation_metrics_unchanged(path, sha256):
    assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == sha256
