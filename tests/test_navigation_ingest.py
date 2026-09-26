"""Navigation/mission metadata ingest for ZIP survey uploads.

Covers: sagar.perception.navigation (CSV/JSON parsing + validation) and the
/api/v1/surveys/upload + /api/v1/runtime/surveys/{id}/report wiring in
packages/sagar/api/app.py. The frozen detector is faked (monkeypatched) so
these tests exercise navigation plumbing deterministically, independent of
what the real model happens to detect in a given raster.
"""
from __future__ import annotations

import csv
import io
import time
import zipfile
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from sagar.api import create_app
from sagar.perception.navigation import (
    NavigationValidationError,
    parse_mission_json,
    parse_navigation_csv,
)
from sagar.perception.runtime import FinalDetector

ROOT = Path(__file__).resolve().parents[1]


def _png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(np.zeros((8, 8, 3), dtype=np.uint8)).save(buffer, format="PNG")
    return buffer.getvalue()


def _zip_bytes(entries: dict[str, bytes | str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def _fake_infer(self, image_path, survey_id, source_image_id):
    """Deterministic stand-in for the frozen detector: always reports exactly
    one SHIPWRECK finding, so navigation inheritance can be asserted without
    depending on what the real model sees in a synthetic test raster."""
    with Image.open(image_path) as image:
        width, height = image.size
    finding = {
        "detection_id": f"det_{survey_id}_{source_image_id}_0000", "survey_id": survey_id,
        "source_frame_id": source_image_id, "source_image_path": str(image_path), "tile_id": None,
        "raw_class_id": 1, "raw_class": "SHIPWRECK", "raw_confidence": 0.42,
        "display_class": "SHIPWRECK", "display_confidence": 0.5, "classification_source": "MODEL",
        "production_qualified": True, "anomaly_score": None, "bbox_px": [1.0, 2.0, 3.0, 4.0],
        "bbox_normalized": [0.1, 0.2, 0.3, 0.4], "pixel_dimensions": [width, height],
        "geo": {"lat": None, "lon": None}, "review_state": None, "review_history": [],
        "model_id": "test_model", "model_sha256": "deadbeef", "dataset_snapshot_id": "test_snapshot",
        "run_id": f"runtime_{survey_id}", "inference_mode": "FULL_FRAME", "tile_size": None, "tile_overlap": None,
    }
    meta = {"width_px": width, "height_px": height, "inference_mode": "FULL_FRAME", "tile_count": 0}
    return meta, [finding]


@pytest.fixture()
def client(monkeypatch) -> TestClient:
    monkeypatch.setattr(FinalDetector, "infer", _fake_infer)
    return TestClient(create_app(ROOT))


def _await_job(client: TestClient, job_id: str, timeout: float = 60.0) -> dict:
    """Poll a real job to a terminal state.

    Survey processing runs on a worker thread so the upload request never
    blocks on inference; the client observes counted progress through
    GET /api/v1/jobs/{job_id} exactly as the workstation does.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{job_id}").json()
        if job["state"] in {"COMPLETED", "FAILED"}:
            return job
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not reach a terminal state within {timeout}s")


def _upload(client: TestClient, filename: str, payload: bytes, content_type: str) -> tuple[dict, dict]:
    response = client.post("/api/v1/surveys/upload", files={"file": (filename, payload, content_type)})
    assert response.status_code == 200, response.text
    body = response.json()
    return body, _await_job(client, body["job_id"])


VALID_NAV_CSV = (
    "frame,timestamp_utc,latitude,longitude,heading_deg,speed_mps,altitude_m\n"
    "sonar_0001.png,2026-09-01T15:30:00Z,18.921840,72.834660,128.4,1.8,14.2\n"
)

VALID_MISSION_JSON = (
    '{"mission_id": "SD-1", "survey_name": "Test Survey", "platform": "AUV-1", '
    '"operator": "Ops Team", "sensor": "Side-scan sonar", "frequency_khz": 900, '
    '"mission_type": "Inspection", "notes": "unit test"}'
)


# --------------------------------------------------------------- unit level


def test_valid_navigation_csv_parses(tmp_path):
    path = tmp_path / "navigation.csv"
    path.write_text(VALID_NAV_CSV)
    parsed = parse_navigation_csv(path)
    assert set(parsed) == {"sonar_0001.png"}
    row = parsed["sonar_0001.png"]
    assert row["latitude"] == pytest.approx(18.921840)
    assert row["longitude"] == pytest.approx(72.834660)
    assert row["heading_deg"] == pytest.approx(128.4)
    assert row["timestamp_utc"] == "2026-09-01T15:30:00Z"


def test_epitome_offshore_demo_navigation_is_ordered_and_consistent():
    navigation = parse_navigation_csv(ROOT / "tests/fixtures/epitome_v2_offshore_navigation.csv")
    points = [(row["latitude"], row["longitude"]) for row in navigation.values()]
    assert len(points) == 7
    # Latitude is Mumbai-like and longitude is safely west of the shoreline demo point.
    assert all(18.90 < latitude < 18.95 and 72.74 < longitude < 72.77 for latitude, longitude in points)
    assert points == sorted(points)
    assert all(row["ping_end"] + 1 == next_row["ping_start"] for row, next_row in zip(navigation.values(), list(navigation.values())[1:]))


def test_optional_mission_json_parses(tmp_path):
    path = tmp_path / "mission.json"
    path.write_text(VALID_MISSION_JSON)
    parsed = parse_mission_json(path)
    assert parsed["survey_name"] == "Test Survey"
    assert parsed["mission_id"] == "SD-1"
    assert parsed["frequency_khz"] == 900


def test_explicit_epitome_sequential_ping_contract_normalizes(tmp_path):
    path = tmp_path / "mission.json"
    path.write_text('{"sequence_mode":"SEQUENTIAL_PING","sequential_ping_evidence":true}')
    assert parse_mission_json(path)["sequential_observations"] is True


@pytest.mark.parametrize(
    "bad_row,expected_field",
    [
        ("sonar_0001.png,2026-09-01T15:30:00Z,91.0,72.834660,,,\n", "latitude"),
        ("sonar_0001.png,2026-09-01T15:30:00Z,-91.0,72.834660,,,\n", "latitude"),
        ("sonar_0001.png,2026-09-01T15:30:00Z,18.921840,181.0,,,\n", "longitude"),
        ("sonar_0001.png,2026-09-01T15:30:00Z,18.921840,-181.0,,,\n", "longitude"),
    ],
)
def test_invalid_lat_lon_rejected(tmp_path, bad_row, expected_field):
    path = tmp_path / "navigation.csv"
    path.write_text("frame,timestamp_utc,latitude,longitude,heading_deg,speed_mps,altitude_m\n" + bad_row)
    with pytest.raises(NavigationValidationError) as excinfo:
        parse_navigation_csv(path)
    assert excinfo.value.field == expected_field


def test_unparseable_timestamp_rejected(tmp_path):
    path = tmp_path / "navigation.csv"
    path.write_text("frame,timestamp_utc,latitude,longitude\nsonar_0001.png,not-a-timestamp,18.0,72.0\n")
    with pytest.raises(NavigationValidationError) as excinfo:
        parse_navigation_csv(path)
    assert excinfo.value.field == "timestamp_utc"


def test_duplicate_frame_rows_rejected(tmp_path):
    path = tmp_path / "navigation.csv"
    path.write_text(
        "frame,timestamp_utc,latitude,longitude\n"
        "sonar_0001.png,2026-09-01T15:30:00Z,18.0,72.0\n"
        "sonar_0001.png,2026-09-01T15:31:00Z,18.1,72.1\n"
    )
    with pytest.raises(NavigationValidationError, match="duplicate"):
        parse_navigation_csv(path)


def test_missing_required_column_rejected(tmp_path):
    path = tmp_path / "navigation.csv"
    path.write_text("frame,latitude,longitude\nsonar_0001.png,18.0,72.0\n")
    with pytest.raises(NavigationValidationError, match="missing required column"):
        parse_navigation_csv(path)


# --------------------------------------------------------------- API level


def test_upload_with_valid_navigation_and_mission(client):
    payload = _zip_bytes({
        "sonar_0001.png": _png_bytes(),
        "navigation.csv": VALID_NAV_CSV,
        "mission.json": VALID_MISSION_JSON,
    })
    body, job = _upload(client, "bundle.zip", payload, "application/zip")
    assert body["state"] == "QUEUED"          # accepted, not yet processed
    assert body["source_frame_count"] == 1     # decoded synchronously, so already true
    assert body["navigation_status"] == "AVAILABLE"
    assert job["state"] == "COMPLETED"
    assert job["frames_completed"] == job["source_frame_count"] == 1
    survey = client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()
    assert survey["navigation_status"] == "AVAILABLE"
    assert survey["name"] == "Test Survey"  # mission.json survey_name preferred
    assert survey["mission"]["mission_id"] == "SD-1"
    assert survey["frames"][0]["navigation"] == {
        "latitude": pytest.approx(18.921840), "longitude": pytest.approx(72.834660),
        "heading_deg": pytest.approx(128.4), "timestamp_utc": "2026-09-01T15:30:00Z", "navigation_status": "AVAILABLE",
    }


def test_multiframe_declared_sequence_persists_contacts_for_runtime_api(client):
    names = [f"sonar_{index:04d}.png" for index in range(1, 4)]
    navigation = "frame,timestamp_utc,latitude,longitude,heading_deg,ping_start,ping_end\n" + "\n".join(
        f"{name},2026-09-01T15:30:{index:02d}Z,18.92184,72.83466,128.4,{120000 + index * 800},{120799 + index * 800}"
        for index, name in enumerate(names)
    ) + "\n"
    mission = '{"sequence_mode":"SEQUENTIAL_PING","sequential_ping_evidence":true}'
    payload = _zip_bytes({**{name: _png_bytes() for name in names}, "navigation.csv": navigation, "mission.json": mission})
    upload_body, _ = _upload(client, "sequence.zip", payload, "application/zip")
    survey = client.get(f"/api/v1/runtime/surveys/{upload_body['survey_id']}").json()
    assert survey["contacts"]
    contact = survey["contacts"][0]
    assert contact["persistence_evidence_type"] == "SEQUENTIAL_PING"
    assert 0 <= contact["confidence"] <= 1
    assert contact["confidence"] == contact["normalized_confidence"]
    assert 0.70 < contact["normalized_confidence"] < 0.90
    assert 0 <= contact["raw_fused_confidence"] <= 1
    assert contact["raw_detector_confidence"] == pytest.approx(0.42)
    assert contact["evidence_strength"] == contact["evidence_score"]
    assert contact["confidence_method"] == "CONTACT_EVIDENCE_FUSION_V1"
    assert contact["confidence_normalization"] == "DEMO_BOUNDED_SIGMOID_V1"
    assert contact["confidence_normalization_range"] == [0.70, 0.90]
    assert "raw_detector" in contact["confidence_components"]
    assert contact["best_observation_id"] in {item["detection_id"] for item in survey["findings"]}
    assert set(contact["source_detection_ids"]).issubset({item["detection_id"] for item in survey["findings"]})
    assert contact["evidence_breakdown"]["score_type"] == "UNVALIDATED_EVIDENCE_FUSION"


def test_findings_inherit_correct_coordinates(client):
    payload = _zip_bytes({
        "sonar_0001.png": _png_bytes(),
        "navigation.csv": VALID_NAV_CSV,
        "mission.json": VALID_MISSION_JSON,
    })
    body, _ = _upload(client, "bundle.zip", payload, "application/zip")
    survey = client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()
    assert len(survey["findings"]) == 1
    finding = survey["findings"][0]
    assert finding["geo"] == {"lat": pytest.approx(18.921840), "lon": pytest.approx(72.834660)}
    assert finding["latitude"] == pytest.approx(18.921840)
    assert finding["longitude"] == pytest.approx(72.834660)
    assert finding["heading_deg"] == pytest.approx(128.4)
    assert finding["timestamp_utc"] == "2026-09-01T15:30:00Z"
    assert finding["navigation_status"] == "AVAILABLE"
    # Raw detector output must never be perturbed by navigation inheritance.
    assert finding["raw_class"] == "SHIPWRECK"
    assert finding["raw_confidence"] == pytest.approx(0.42)


def test_frame_with_no_navigation_row_stays_null(client):
    nav_csv = "frame,timestamp_utc,latitude,longitude\nsonar_0002.png,2026-09-01T15:30:00Z,18.0,72.0\n"
    payload = _zip_bytes({
        "sonar_0001.png": _png_bytes(),  # not referenced by navigation.csv
        "sonar_0002.png": _png_bytes(),
        "navigation.csv": nav_csv,
    })
    body, _ = _upload(client, "bundle.zip", payload, "application/zip")
    survey = client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()
    assert survey["navigation_status"] == "AVAILABLE"  # navigation.csv itself was valid
    by_source_path = {Path(f["source_path"]).name: f for f in survey["frames"]}
    unmatched_frame = by_source_path["sonar_0001.png"]
    matched_frame = by_source_path["sonar_0002.png"]
    assert unmatched_frame["navigation"] == {
        "latitude": None, "longitude": None, "heading_deg": None, "timestamp_utc": None, "navigation_status": "UNAVAILABLE",
    }
    assert matched_frame["navigation"]["navigation_status"] == "AVAILABLE"
    findings_by_frame = {f["source_frame_id"]: f for f in survey["findings"]}
    unmatched_finding = findings_by_frame[unmatched_frame["frame_id"]]
    assert unmatched_finding["geo"] == {"lat": None, "lon": None}
    assert unmatched_finding["navigation_status"] == "UNAVAILABLE"
    matched_finding = findings_by_frame[matched_frame["frame_id"]]
    assert matched_finding["geo"] == {"lat": 18.0, "lon": 72.0}
    assert matched_finding["navigation_status"] == "AVAILABLE"


def test_missing_referenced_frame_rejected_with_4xx(client):
    nav_csv = "frame,timestamp_utc,latitude,longitude\nsonar_9999.png,2026-09-01T15:30:00Z,18.0,72.0\n"
    payload = _zip_bytes({"sonar_0001.png": _png_bytes(), "navigation.csv": nav_csv})
    response = client.post("/api/v1/surveys/upload", files={"file": ("bundle.zip", payload, "application/zip")})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_FAILED"
    assert "sonar_9999.png" in error["message"]
    assert error["detail"]["field"] == "frame"


def test_invalid_navigation_rejected_with_row_and_field(client):
    nav_csv = "frame,timestamp_utc,latitude,longitude\nsonar_0001.png,2026-09-01T15:30:00Z,18.0,181.0\n"
    payload = _zip_bytes({"sonar_0001.png": _png_bytes(), "navigation.csv": nav_csv})
    response = client.post("/api/v1/surveys/upload", files={"file": ("bundle.zip", payload, "application/zip")})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_FAILED"
    assert error["detail"]["field"] == "longitude"
    assert error["detail"]["row"] == 2


def test_reports_preserve_navigation_coordinates(client):
    payload = _zip_bytes({
        "sonar_0001.png": _png_bytes(),
        "navigation.csv": VALID_NAV_CSV,
        "mission.json": VALID_MISSION_JSON,
    })
    upload_body, _ = _upload(client, "bundle.zip", payload, "application/zip")
    survey_id = upload_body["survey_id"]

    json_report = client.get(f"/api/v1/runtime/surveys/{survey_id}/report?format=json").json()
    assert json_report["findings"][0]["geo"]["lat"] == pytest.approx(18.921840)
    assert json_report["mission"]["survey_name"] == "Test Survey"

    csv_report = client.get(f"/api/v1/runtime/surveys/{survey_id}/report?format=csv")
    rows = list(csv.DictReader(io.StringIO(csv_report.text)))
    assert len(rows) == 1
    assert float(rows[0]["latitude"]) == pytest.approx(18.921840)
    assert float(rows[0]["longitude"]) == pytest.approx(72.834660)
    assert float(rows[0]["heading_deg"]) == pytest.approx(128.4)
    assert rows[0]["timestamp_utc"] == "2026-09-01T15:30:00Z"
    assert rows[0]["navigation_status"] == "AVAILABLE"


def test_old_image_only_zip_uploads_still_work_exactly_as_before(client):
    payload = _zip_bytes({"sonar_0001.png": _png_bytes(), "sonar_0002.png": _png_bytes()})
    body, job = _upload(client, "plain_bundle.zip", payload, "application/zip")
    assert job["state"] == "COMPLETED"
    survey = client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()
    assert survey["navigation_status"] == "UNAVAILABLE"
    assert survey["mission"] is None
    assert survey["name"] == "plain_bundle.zip"  # unchanged filename-derived fallback
    assert len(survey["findings"]) == 2
    for finding in survey["findings"]:
        assert finding["geo"] == {"lat": None, "lon": None}
        assert finding["latitude"] is None
        assert finding["longitude"] is None
        assert finding["heading_deg"] is None
        assert finding["timestamp_utc"] is None
        assert finding["navigation_status"] == "UNAVAILABLE"
    for frame in survey["frames"]:
        assert frame["navigation"]["navigation_status"] == "UNAVAILABLE"


def test_single_image_upload_unaffected(client):
    body, job = _upload(client, "sonar.png", _png_bytes(), "image/png")
    assert job["state"] == "COMPLETED"
    survey = client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()
    assert survey["navigation_status"] == "UNAVAILABLE"
    assert survey["mission"] is None
