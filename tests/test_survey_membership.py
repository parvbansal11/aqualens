"""Round-2 ticket B1: additive per-Frame Survey membership.

A Survey is one contiguous recording from one sonar during one pass; an Upload may hold several.
Under B1 every Frame is its own SINGLETON Survey: no membership is declared or verified yet
(B3/B4 own that). The legacy Upload identifier (``survey_id``) and every existing API field
are unchanged. The frozen detector is faked and every test uses an isolated runtime directory.
"""
from __future__ import annotations

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

# Field sets returned before B1 (packages/sagar/api/app.py at HEAD).
LEGACY_UPLOAD_RESPONSE_KEYS = {"upload_id", "job_id", "survey_id", "state", "source_frame_count", "navigation_status", "accepted"}
LEGACY_RECORD_KEYS = {"survey_id", "name", "frames", "findings", "contacts", "created_at", "navigation_status", "mission",
                      "model_registry", "contact_fusion_policy", "sequential_observation_contract"}
LEGACY_FRAME_KEYS = {"frame_id", "source_path", "width_px", "height_px", "inference_mode", "tile_count", "navigation", "sonar_condition"}
LEGACY_INDEX_KEYS = {"survey_id", "name", "created_at", "frame_count", "finding_count", "contact_count", "reviewed_count", "navigation_status"}
SURVEY_KEYS = {"survey_ref", "frame_ids", "membership_provenance", "geometry_signature", "navigation_provenance"}


def _png(seed: int, size: tuple[int, int] = (8, 8)) -> bytes:
    # Textured, distinct rasters (the sonar-condition engine rejects uniform non-zero rasters).
    pixels = np.random.default_rng(seed).integers(0, 256, (size[1], size[0], 3), dtype=np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PNG")
    return buffer.getvalue()


def _zip(entries: list[tuple[str, bytes | str]]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in entries:
            archive.writestr(name, content)
    return buffer.getvalue()


def _fake_infer(self, image_path, survey_id, source_image_id):
    with Image.open(image_path) as image:
        width, height = image.size
    finding = {
        "detection_id": f"det_{survey_id}_{source_image_id}_0000", "survey_id": survey_id,
        "source_frame_id": source_image_id, "source_image_path": str(image_path), "tile_id": None,
        "raw_class_id": 0, "raw_class": "CRAB_POT", "raw_confidence": 0.42,
        "display_class": "CRAB_POT", "display_confidence": 0.5, "classification_source": "MODEL",
        "production_qualified": True, "anomaly_score": None, "bbox_px": [1.0, 2.0, 3.0, 4.0],
        "bbox_normalized": [1.0 / width, 2.0 / height, 3.0 / width, 4.0 / height], "pixel_dimensions": [width, height],
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


def _upload(client: TestClient, entries: list[tuple[str, bytes | str]]) -> tuple[dict, dict]:
    response = client.post("/api/v1/surveys/upload", files={"file": ("bundle.zip", _zip(entries), "application/zip")})
    assert response.status_code == 200, response.text
    body = response.json()
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{body['job_id']}").json()
        if job["state"] in {"COMPLETED", "FAILED"}:
            break
        time.sleep(0.02)
    assert job["state"] == "COMPLETED", job
    return body, client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()


THREE_FRAMES = [("sonar_a.png", _png(10)), ("sonar_b.png", _png(20)), ("sonar_c.png", _png(30))]


def _memberships_by_filename(record: dict) -> list[list[str]]:
    name = {frame["frame_id"]: Path(frame["source_path"]).name for frame in record["frames"]}
    return sorted(sorted(name[frame_id] for frame_id in survey["frame_ids"]) for survey in record["surveys"])


def test_every_frame_belongs_to_exactly_one_survey(client):
    _, record = _upload(client, THREE_FRAMES)
    frame_ids = [frame["frame_id"] for frame in record["frames"]]
    members = [frame_id for survey in record["surveys"] for frame_id in survey["frame_ids"]]
    assert sorted(members) == sorted(frame_ids)          # every Frame is in a Survey, none twice
    by_ref = {survey["survey_ref"]: survey for survey in record["surveys"]}
    assert len(by_ref) == len(record["surveys"])         # Survey refs are unique
    for frame in record["frames"]:
        assert frame["frame_id"] in by_ref[frame["survey_ref"]]["frame_ids"]


def test_multi_frame_upload_defaults_to_singleton_surveys(client):
    # Navigation rows and a declared sequential contract do not declare Survey membership.
    navigation = "frame,timestamp_utc,latitude,longitude,ping_start,ping_end\n" + "".join(
        f"{name},2026-09-01T15:30:0{i}Z,18.9,72.8,{100 * i},{100 * i + 99}\n" for i, (name, _) in enumerate(THREE_FRAMES))
    _, record = _upload(client, THREE_FRAMES + [("navigation.csv", navigation),
                                                ("mission.json", json.dumps({"sequential_observations": True}))])
    assert _memberships_by_filename(record) == [["sonar_a.png"], ["sonar_b.png"], ["sonar_c.png"]]
    for survey in record["surveys"]:
        assert set(survey) == SURVEY_KEYS
        assert survey["membership_provenance"] == "SINGLETON"
        assert survey["navigation_provenance"] is None   # no provenance is declared by any Upload yet
        assert survey["geometry_signature"] == {"width_px": 8, "height_px": 8, "channel_layout": "RGB"}


def test_existing_api_response_fields_are_unchanged(client):
    body, record = _upload(client, THREE_FRAMES)
    assert set(body) == LEGACY_UPLOAD_RESPONSE_KEYS
    assert record["survey_id"] == body["survey_id"] == f"survey_{body['upload_id']}"
    assert LEGACY_RECORD_KEYS <= set(record)
    assert [frame["frame_id"] for frame in record["frames"]] == ["frame_0000", "frame_0001", "frame_0002"]
    assert all(LEGACY_FRAME_KEYS <= set(frame) for frame in record["frames"])
    index = client.get("/api/v1/runtime/surveys").json()
    assert set(index) == {"items", "total"} and index["items"]
    assert all(set(row) == LEGACY_INDEX_KEYS for row in index["items"])


def test_survey_membership_fields_are_additive(client):
    _, record = _upload(client, THREE_FRAMES)
    assert set(record) - LEGACY_RECORD_KEYS == {"surveys"}
    # B1 adds survey_ref; B2 adds the per-Frame raster identity (duplicate-raster flag); B5 persists
    # the per-Frame geometry signature that Survey membership is checked against.
    b2_frame_keys = {"raster_sha256", "raster_duplicate_status", "duplicate_raster_frame_ids"}
    b5_frame_keys = {"geometry_signature"}
    assert all(set(frame) - LEGACY_FRAME_KEYS == {"survey_ref"} | b2_frame_keys | b5_frame_keys for frame in record["frames"])


def _legacy_record() -> dict:
    frame = {"source_path": "/nonexistent/legacy.png", "width_px": 640, "height_px": 640, "inference_mode": "FULL_FRAME",
             "tile_count": 0, "navigation": {"navigation_status": "UNAVAILABLE"}, "sonar_condition": {}}
    return {"survey_id": "survey_upload_legacy", "name": "legacy", "created_at": "2026-09-01T00:00:00+00:00",
            "frames": [{**frame, "frame_id": "frame_0000"}, {**frame, "frame_id": "frame_0001"}],
            "findings": [], "contacts": [], "navigation_status": "UNAVAILABLE", "mission": None,
            "model_registry": {}, "contact_fusion_policy": "contact_fusion@v1", "sequential_observation_contract": False}


def _app_over_stored_state(monkeypatch, runtime_dir: Path) -> TestClient:
    monkeypatch.setattr(FinalDetector, "infer", _fake_infer)
    monkeypatch.setenv("SAGARDRISHTI_RUNTIME_DIR", str(runtime_dir))
    return TestClient(create_app(ROOT))


def test_stored_record_without_survey_fields_hydrates_to_singleton_surveys(monkeypatch, runtime_dir):
    runtime_dir.mkdir(parents=True)
    state = runtime_dir / "runtime_surveys.json"
    state.write_text(json.dumps({"survey_upload_legacy": _legacy_record()}))
    stored = state.read_bytes()
    record = _app_over_stored_state(monkeypatch, runtime_dir).get("/api/v1/runtime/surveys/survey_upload_legacy").json()
    assert [frame["survey_ref"] for frame in record["frames"]] == ["survey_upload_legacy.frame_0000", "survey_upload_legacy.frame_0001"]
    assert record["surveys"] == [
        {"survey_ref": "survey_upload_legacy.frame_0000", "frame_ids": ["frame_0000"], "membership_provenance": "SINGLETON",
         "geometry_signature": {"width_px": 640, "height_px": 640, "channel_layout": None}, "navigation_provenance": None},
        {"survey_ref": "survey_upload_legacy.frame_0001", "frame_ids": ["frame_0001"], "membership_provenance": "SINGLETON",
         "geometry_signature": {"width_px": 640, "height_px": 640, "channel_layout": None}, "navigation_provenance": None},
    ]
    assert state.read_bytes() == stored   # reading old state never rewrites it


def test_survey_refs_are_deterministic(monkeypatch, runtime_dir, client):
    body, first = _upload(client, THREE_FRAMES)
    assert [frame["survey_ref"] for frame in first["frames"]] == [f"{body['survey_id']}.frame_{i:04d}" for i in range(3)]
    reloaded = _app_over_stored_state(monkeypatch, runtime_dir).get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()
    assert reloaded["surveys"] == first["surveys"]
    assert [frame["survey_ref"] for frame in reloaded["frames"]] == [frame["survey_ref"] for frame in first["frames"]]


def test_zip_member_order_does_not_change_survey_membership(client):
    body_forward, forward = _upload(client, THREE_FRAMES)
    body_reversed, reversed_order = _upload(client, list(reversed(THREE_FRAMES)))
    assert _memberships_by_filename(forward) == _memberships_by_filename(reversed_order)

    def ref_suffix_by_filename(body: dict, record: dict) -> dict[str, str]:
        return {Path(frame["source_path"]).name: frame["survey_ref"].removeprefix(body["survey_id"]) for frame in record["frames"]}

    assert ref_suffix_by_filename(body_forward, forward) == ref_suffix_by_filename(body_reversed, reversed_order)
