"""Round-2 ticket B6: Survey membership and navigation provenance in JSON and CSV reports (B-AC5, B-AC6).

Additive only. Every existing report field and column keeps its name, position and value. The
Survey fields are copied from the stored Survey membership (``survey_ref``, ``membership_provenance``,
``navigation_provenance``); a report never derives, upgrades or infers them. The frozen detector is
faked and every test uses an isolated runtime directory.
"""
from __future__ import annotations

import csv
import io
import json
import time
import zipfile
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from sagar.api import create_app
from sagar.perception.runtime import FinalDetector

ROOT = Path(__file__).resolve().parents[1]

# Report columns as they were before B6; they must stay first and in this order.
LEGACY_OBSERVATION_COLUMNS = ["detection_id", "source_frame_id", "raw_class", "raw_confidence", "display_class", "display_confidence",
                              "classification_source", "production_qualified", "review_state", "bbox_px", "latitude", "longitude",
                              "heading_deg", "timestamp_utc", "navigation_status"]
LEGACY_CONTACT_COLUMNS = ["contact_id", "resolved_class", "candidate_classes", "observation_count", "distinct_frame_observation_count",
                          "persistence_evidence_type", "confidence", "raw_fused_confidence", "normalized_confidence", "raw_detector_confidence",
                          "max_raw_confidence", "evidence_strength", "evidence_score", "evidence_score_type", "confidence_method",
                          "confidence_normalization", "confidence_normalization_range", "missing_evidence_components", "priority_band",
                          "priority_score", "recommended_action", "anomaly_score", "anomaly_threshold", "is_open_set_candidate",
                          "quality_score", "quality_flags", "latitude", "longitude", "navigation_status", "localization_uncertainty_status",
                          "review_verdict", "review_count", "source_detection_ids", "best_observation_id", "detector_model_sha"]
SURVEY_COLUMNS = ["survey_ref", "membership_provenance", "navigation_provenance"]


def _fake_infer(self, image_path, survey_id, source_image_id):
    with Image.open(image_path) as image:
        width, height = image.size
    finding = {
        "detection_id": f"det_{survey_id}_{source_image_id}_0000", "survey_id": survey_id,
        "source_frame_id": source_image_id, "source_image_path": str(image_path), "tile_id": None,
        "raw_class_id": 1, "raw_class": "SHIPWRECK", "raw_confidence": 0.42,
        "display_class": "SHIPWRECK", "display_confidence": 0.5, "classification_source": "MODEL",
        "production_qualified": True, "anomaly_score": None, "bbox_px": [4.0, 4.0, 12.0, 12.0],
        "bbox_normalized": [4.0 / width, 4.0 / height, 12.0 / width, 12.0 / height], "pixel_dimensions": [width, height],
        "geo": {"lat": None, "lon": None}, "review_state": None, "review_history": [],
        "model_id": "test_model", "model_sha256": "deadbeef", "dataset_snapshot_id": "test_snapshot",
        "run_id": f"runtime_{survey_id}", "inference_mode": "FULL_FRAME", "tile_size": None, "tile_overlap": None,
    }
    return {"width_px": width, "height_px": height, "inference_mode": "FULL_FRAME", "tile_count": 0}, [finding]


@pytest.fixture()
def runtime_dir(tmp_path) -> Path:
    return tmp_path / "runtime"


@pytest.fixture()
def client(monkeypatch, runtime_dir) -> TestClient:
    monkeypatch.setattr(FinalDetector, "infer", _fake_infer)
    monkeypatch.setenv("SAGARDRISHTI_RUNTIME_DIR", str(runtime_dir))
    return TestClient(create_app(ROOT))


def _png(pixels: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PNG")
    return buffer.getvalue()


def _mixed_membership_rasters() -> dict[str, bytes]:
    """DECLARED a/b (64x48), VERIFIED s0/s1 (a 10-row shift, 40x60) and a SINGLETON x (32x32)."""
    rng = np.random.default_rng(7)
    waterfall = rng.integers(0, 256, (70, 40, 3), dtype=np.uint8)
    return {
        "a.png": _png(rng.integers(0, 256, (48, 64, 3), dtype=np.uint8)),
        "b.png": _png(rng.integers(0, 256, (48, 64, 3), dtype=np.uint8)),
        "s0.png": _png(waterfall[0:60]), "s1.png": _png(waterfall[10:70]),
        "x.png": _png(rng.integers(0, 256, (32, 32, 3), dtype=np.uint8)),
    }


# Navigation rows for a, b and s0 only: s1 and x have none.
_NAVIGATION = ("frame,timestamp_utc,latitude,longitude\n"
               "a.png,2026-09-01T15:30:00Z,18.0,72.0\nb.png,2026-09-01T15:30:01Z,18.0,72.0\ns0.png,2026-09-01T15:30:02Z,18.0,72.0\n")

# Independently stated expectations per raster: (membership, navigation provenance under MEASURED).
_EXPECTED = {"a.png": ("DECLARED", "MEASURED"), "b.png": ("DECLARED", "MEASURED"),
             "s0.png": ("VERIFIED", None), "s1.png": ("VERIFIED", None), "x.png": ("SINGLETON", None)}


def _upload(client: TestClient, rasters: dict[str, bytes], mission: dict | None = None,
            navigation: str | None = _NAVIGATION, provenance: dict | None = None) -> str:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in rasters.items():
            archive.writestr(name, content)
        if navigation is not None:
            archive.writestr("navigation.csv", navigation)
        if mission is not None:
            archive.writestr("mission.json", json.dumps(mission))
        if provenance is not None:
            archive.writestr("provenance.json", json.dumps(provenance))
    response = client.post("/api/v1/surveys/upload", files={"file": ("bundle.zip", buffer.getvalue(), "application/zip")})
    assert response.status_code == 200, response.text
    body = response.json()
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{body['job_id']}").json()
        if job["state"] in {"COMPLETED", "FAILED"}:
            break
        time.sleep(0.02)
    assert job["state"] == "COMPLETED", job
    return body["survey_id"]


def _csv(client: TestClient, survey_id: str, scope: str) -> tuple[list[str], list[dict[str, str]]]:
    response = client.get(f"/api/v1/runtime/surveys/{survey_id}/report?format=csv&scope={scope}")
    assert response.status_code == 200, response.text
    reader = csv.DictReader(io.StringIO(response.text))
    return list(reader.fieldnames or []), list(reader)


def _raster_name(record: dict) -> dict[str, str]:
    return {frame["frame_id"]: Path(frame["source_path"]).name for frame in record["frames"]}


_MISSION = {"declared_surveys": [["a.png", "b.png"]], "navigation_provenance": "MEASURED"}


def test_json_report_carries_the_surveys_list_membership_and_navigation_provenance(client):
    survey_id = _upload(client, _mixed_membership_rasters(), _MISSION)
    record = client.get(f"/api/v1/runtime/surveys/{survey_id}").json()
    report = client.get(f"/api/v1/runtime/surveys/{survey_id}/report?format=json").json()
    assert report["surveys"] == record["surveys"]
    assert report["mission"]["navigation_provenance"] == "MEASURED"
    names = _raster_name(report)
    by_ref = {item["survey_ref"]: item for item in report["surveys"]}
    for frame in report["frames"]:
        entry = by_ref[frame["survey_ref"]]
        assert (entry["membership_provenance"], entry["navigation_provenance"]) == _EXPECTED[names[frame["frame_id"]]]
    (verified,) = [item for item in report["surveys"] if item["membership_provenance"] == "VERIFIED"]
    assert verified["ping_relationship"]["provenance"] == "DERIVED_FROM_SOURCE"


def test_observation_csv_adds_survey_membership_after_the_existing_columns(client):
    survey_id = _upload(client, _mixed_membership_rasters(), _MISSION)
    record = client.get(f"/api/v1/runtime/surveys/{survey_id}").json()
    columns, rows = _csv(client, survey_id, "observations")
    assert columns == LEGACY_OBSERVATION_COLUMNS + SURVEY_COLUMNS
    names = _raster_name(record)
    frames = {frame["frame_id"]: frame for frame in record["frames"]}
    assert len(rows) == 5
    for row in rows:
        name = names[row["source_frame_id"]]
        assert row["survey_ref"] == frames[row["source_frame_id"]]["survey_ref"]
        membership, navigation = _EXPECTED[name]
        assert row["membership_provenance"] == membership
        assert row["navigation_provenance"] == (navigation or "")  # null is an empty cell, as elsewhere in the CSV


def test_contact_csv_adds_survey_membership_after_the_existing_columns(client):
    survey_id = _upload(client, _mixed_membership_rasters(), _MISSION)
    record = client.get(f"/api/v1/runtime/surveys/{survey_id}").json()
    columns, rows = _csv(client, survey_id, "contacts")
    assert columns == LEGACY_CONTACT_COLUMNS + SURVEY_COLUMNS
    names = _raster_name(record)
    frames = {frame["frame_id"]: frame for frame in record["frames"]}
    contacts = {contact["contact_id"]: contact for contact in record["contacts"]}
    assert len(rows) == 5  # no two Observations associate here (the verified s0/s1 boxes are different pings), so each Contact is one Frame's
    for row in rows:
        (frame_id,) = contacts[row["contact_id"]]["source_frame_ids"]
        assert row["survey_ref"] == frames[frame_id]["survey_ref"]
        membership, navigation = _EXPECTED[names[frame_id]]
        assert (row["membership_provenance"], row["navigation_provenance"]) == (membership, navigation or "")


def test_synthetic_and_undeclared_navigation_are_reported_as_they_are_stored(client):
    rasters = {name: content for name, content in _mixed_membership_rasters().items() if name in {"a.png", "x.png"}}
    navigation = "frame,timestamp_utc,latitude,longitude\na.png,2026-09-01T15:30:00Z,18.0,72.0\nx.png,2026-09-01T15:30:01Z,18.0,72.0\n"
    synthetic = _upload(client, rasters, navigation=navigation, provenance={"navigation_source": "SYNTHETIC_DEMO_NAVIGATION"})
    undeclared = _upload(client, rasters, navigation=navigation)
    for survey_id, expected in ((synthetic, "SYNTHETIC_DEMO"), (undeclared, "")):
        for scope in ("observations", "contacts"):
            _, rows = _csv(client, survey_id, scope)
            assert [(row["membership_provenance"], row["navigation_provenance"]) for row in rows] == [("SINGLETON", expected)] * 2


def test_report_survey_columns_do_not_depend_on_upload_order(client):
    rasters = _mixed_membership_rasters()
    projections = []
    for order in (sorted(rasters), sorted(rasters, reverse=True)):
        survey_id = _upload(client, {name: rasters[name] for name in order}, _MISSION)
        names = _raster_name(client.get(f"/api/v1/runtime/surveys/{survey_id}").json())
        _, rows = _csv(client, survey_id, "observations")
        projections.append(sorted((names[row["source_frame_id"]], row["survey_ref"].split(".", 1)[1],
                                   row["membership_provenance"], row["navigation_provenance"]) for row in rows))
    assert projections[0] == projections[1]


def test_stored_record_without_survey_fields_reports_its_hydrated_singleton_surveys(monkeypatch, runtime_dir):
    """A retained record from before B1 reports the SINGLETON Surveys it hydrates to. A legacy Contact
    that spans two Frames (from before A3) lists each distinct Survey, in the CSV's ``|`` convention."""
    frame = {"source_path": "/nonexistent/legacy.png", "width_px": 640, "height_px": 640, "inference_mode": "FULL_FRAME",
             "tile_count": 0, "navigation": {"navigation_status": "UNAVAILABLE"}, "sonar_condition": {}}
    finding = {"source_image_path": "/nonexistent/legacy.png", "raw_class": "SHIPWRECK", "raw_confidence": 0.4, "bbox_px": [1, 2, 3, 4]}
    record = {"survey_id": "survey_upload_legacy", "name": "legacy", "created_at": "2026-09-01T00:00:00+00:00",
              "frames": [{**frame, "frame_id": "frame_0000"}, {**frame, "frame_id": "frame_0001"}],
              "findings": [{**finding, "detection_id": "det_0", "source_frame_id": "frame_0000"},
                           {**finding, "detection_id": "det_1", "source_frame_id": "frame_0001"}],
              "contacts": [{"contact_id": "contact_legacy", "source_frame_ids": ["frame_0000", "frame_0001"],
                            "source_detection_ids": ["det_0", "det_1"]}],
              "navigation_status": "UNAVAILABLE", "mission": None, "model_registry": {},
              "contact_fusion_policy": "contact_fusion@v1", "sequential_observation_contract": False}
    runtime_dir.mkdir(parents=True)
    (runtime_dir / "runtime_surveys.json").write_text(json.dumps({"survey_upload_legacy": record}))
    monkeypatch.setattr(FinalDetector, "infer", _fake_infer)
    monkeypatch.setenv("SAGARDRISHTI_RUNTIME_DIR", str(runtime_dir))
    client = TestClient(create_app(ROOT))

    _, observations = _csv(client, "survey_upload_legacy", "observations")
    assert [(row["survey_ref"], row["membership_provenance"], row["navigation_provenance"]) for row in observations] == [
        ("survey_upload_legacy.frame_0000", "SINGLETON", ""), ("survey_upload_legacy.frame_0001", "SINGLETON", ""),
    ]
    _, contacts = _csv(client, "survey_upload_legacy", "contacts")
    assert [(row["survey_ref"], row["membership_provenance"], row["navigation_provenance"]) for row in contacts] == [
        ("survey_upload_legacy.frame_0000|survey_upload_legacy.frame_0001", "SINGLETON|SINGLETON", "|"),
    ]
