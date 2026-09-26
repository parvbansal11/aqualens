"""Round-2 ticket B3: navigation provenance is recorded, and navigation is never evidence on its own.

Navigation provenance is one of MEASURED, DERIVED_FROM_SOURCE or SYNTHETIC_DEMO, or null when the
Upload does not declare it (PID-23). Coordinates existing never imply MEASURED. MEASURED is a
declaration, not a verification: no declared provenance establishes a ping relationship, and so no
association across Frames, no independent Look and no persistence (since A7, Frames relate only through
the relationship derived from their pixels, B4). DERIVED_FROM_SOURCE cannot be declared. The frozen detector is faked and every test uses an
isolated runtime directory.
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
from sagar.perception.navigation import NavigationValidationError, parse_bundle_provenance, parse_mission_json
from sagar.perception.runtime import FinalDetector

ROOT = Path(__file__).resolve().parents[1]
NAMES = ("sonar_0001.png", "sonar_0002.png", "sonar_0003.png")
SEQUENTIAL_CONTRACT = {"sequence_mode": "SEQUENTIAL_PING", "sequential_ping_evidence": True}
# The structured synthetic labels written by the internal demo bundle builders
# (scripts/build_epitome_v2_offshore_demo.py, build_epitome_v3_realdata_demo.py, build_epitome_v4_realdata_demo.py).
V2_PROVENANCE = {"bundle": "Aqualens_Epitome_v2_Offshore_Demo", "navigation_provenance": "SYNTHETIC_DEMO_METADATA"}
V3_PROVENANCE = {"bundle": "Aqualens_Epitome_v3_RealData_BayOfBengal", "navigation_source": "SYNTHETIC_DEMO_NAVIGATION",
                 "metadata_source": "SYNTHETIC_DEMO_METADATA"}
V4_PROVENANCE = {"bundle": "Aqualens_Epitome_v4_RealData_VariedConfidence", "navigation_source": "SYNTHETIC_DEMO_NAVIGATION",
                 "navigation_is_synthetic": True}


def _png(seed: int, size: tuple[int, int] = (32, 32)) -> bytes:
    # Textured, byte-distinct rasters: identical copies would be DUPLICATE_RASTER (B2), which is a different guard.
    pixels = np.random.default_rng(seed).integers(0, 256, (size[1], size[0], 3), dtype=np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PNG")
    return buffer.getvalue()


def _fake_infer(self, image_path, survey_id, source_image_id):
    """The same box on every Frame, so a declared ping relationship would chain the Frames into one Contact."""
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


def _navigation_csv(lat: float = 18.92184, lon: float = 72.83466, spread_deg: float = 0.0) -> str:
    """Contiguous, disjoint declared ping bounds: the shape A3 treats as independent Looks when a ping relationship exists."""
    return "frame,timestamp_utc,latitude,longitude,heading_deg,ping_start,ping_end\n" + "".join(
        f"{name},2026-09-01T15:30:{index:02d}Z,{lat + index * spread_deg},{lon},128.4,{120000 + index * 800},{120799 + index * 800}\n"
        for index, name in enumerate(NAMES)
    )


def _bundle(mission: dict | None = None, provenance: dict | None = None, navigation: str | None = None) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for seed, name in enumerate(NAMES):
            archive.writestr(name, _png(seed))
        if navigation is not None:
            archive.writestr("navigation.csv", navigation)
        if mission is not None:
            archive.writestr("mission.json", json.dumps(mission))
        if provenance is not None:
            archive.writestr("provenance.json", json.dumps(provenance))
    return buffer.getvalue()


def _post(client: TestClient, payload: bytes):
    return client.post("/api/v1/surveys/upload", files={"file": ("bundle.zip", payload, "application/zip")})


def _survey(client: TestClient, payload: bytes) -> dict:
    response = _post(client, payload)
    assert response.status_code == 200, response.text
    body = response.json()
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{body['job_id']}").json()
        if job["state"] in {"COMPLETED", "FAILED"}:
            break
        time.sleep(0.02)
    assert job["state"] == "COMPLETED", job
    return client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()


def _write(tmp_path: Path, name: str, value: dict) -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(value))
    return path


def _groupings(survey: dict) -> list[tuple[str, ...]]:
    by_frame = {frame["frame_id"]: Path(frame["source_path"]).name for frame in survey["frames"]}
    return sorted(tuple(sorted(by_frame[frame_id] for frame_id in contact["source_frame_ids"])) for contact in survey["contacts"])


def _assert_no_navigation_evidence(survey: dict) -> None:
    """No ping relationship, association across Frames, independent Look or persistence."""
    assert all(finding["sequential_observation_supported"] is False for finding in survey["findings"])
    assert len(survey["contacts"]) == len(NAMES)
    for contact in survey["contacts"]:
        assert len(contact["source_frame_ids"]) == 1
        assert contact["look_count"] == 1
        assert contact["association_basis"] == "SINGLE"
        assert contact["persistence_evidence_type"] == "SINGLE_OBSERVATION"
    assert {item["membership_provenance"] for item in survey["surveys"]} == {"SINGLETON"}


# ------------------------------------------------------------- parsing (unit)

@pytest.mark.parametrize("provenance", [V2_PROVENANCE, V3_PROVENANCE, V4_PROVENANCE], ids=["v2", "v3", "v4"])
def test_existing_synthetic_demo_labels_normalize_to_synthetic_demo(tmp_path, provenance):
    assert parse_bundle_provenance(_write(tmp_path, "provenance.json", provenance)) == "SYNTHETIC_DEMO"


# DERIVED_FROM_SOURCE is a spec value but is produced only by Aqualens after B4 source verification
# (pre-A7 closure); an Upload that declares it is rejected, see test_stored_record_rebuild.py.
@pytest.mark.parametrize("value", ["MEASURED", "SYNTHETIC_DEMO"])
def test_mission_declares_navigation_provenance_with_the_spec_values(tmp_path, value):
    assert parse_mission_json(_write(tmp_path, "mission.json", {"navigation_provenance": value}))["navigation_provenance"] == value


def test_undeclared_navigation_provenance_is_null(tmp_path):
    assert parse_mission_json(_write(tmp_path, "mission.json", {"mission_id": "SD-1"}))["navigation_provenance"] is None
    assert parse_bundle_provenance(_write(tmp_path, "provenance.json", {"bundle": "unlabelled"})) is None


@pytest.mark.parametrize("value", ["UNKNOWN", "UNDECLARED", "ASSUMED", "measured", "", 1, "DERIVED_FROM_SOURCE"])
def test_navigation_provenance_outside_the_spec_values_is_rejected(tmp_path, value):
    with pytest.raises(NavigationValidationError) as error:
        parse_mission_json(_write(tmp_path, "mission.json", {"navigation_provenance": value}))
    assert error.value.field == "navigation_provenance"


# ------------------------------------------------------------ runtime (API)

def test_coordinates_without_a_declaration_record_null_provenance_and_establish_nothing(client):
    survey = _survey(client, _bundle(mission=SEQUENTIAL_CONTRACT, navigation=_navigation_csv()))
    assert survey["mission"]["navigation_provenance"] is None
    assert [item["navigation_provenance"] for item in survey["surveys"]] == [None] * len(NAMES)
    _assert_no_navigation_evidence(survey)


@pytest.mark.parametrize("provenance", [V2_PROVENANCE, V4_PROVENANCE], ids=["v2", "v4"])
def test_synthetic_demo_bundle_is_displayed_but_never_establishes_association_looks_or_persistence(client, provenance):
    survey = _survey(client, _bundle(mission=SEQUENTIAL_CONTRACT, provenance=provenance, navigation=_navigation_csv()))
    assert [item["navigation_provenance"] for item in survey["surveys"]] == ["SYNTHETIC_DEMO"] * len(NAMES)
    # Displayed: every Frame and Observation still carries its coordinates.
    assert all(frame["navigation"]["navigation_status"] == "AVAILABLE" for frame in survey["frames"])
    assert all(finding["geo"]["lat"] is not None for finding in survey["findings"])
    _assert_no_navigation_evidence(survey)


@pytest.mark.parametrize("value", ["MEASURED"])  # DERIVED_FROM_SOURCE can no longer be declared (pre-A7 closure)
def test_a_declared_provenance_is_carried_but_does_not_by_itself_verify_anything(client, value):
    survey = _survey(client, _bundle(mission={**SEQUENTIAL_CONTRACT, "navigation_provenance": value}, navigation=_navigation_csv()))
    assert survey["mission"]["navigation_provenance"] == value
    assert [item["navigation_provenance"] for item in survey["surveys"]] == [value] * len(NAMES)
    _assert_no_navigation_evidence(survey)


def test_frames_without_a_navigation_row_carry_null_provenance(client):
    navigation = "frame,timestamp_utc,latitude,longitude\nsonar_0002.png,2026-09-01T15:30:00Z,18.0,72.0\n"
    survey = _survey(client, _bundle(mission={"navigation_provenance": "MEASURED"}, navigation=navigation))
    by_ref = {item["survey_ref"]: item["navigation_provenance"] for item in survey["surveys"]}
    assert {Path(frame["source_path"]).name: by_ref[frame["survey_ref"]] for frame in survey["frames"]} == {
        "sonar_0001.png": None, "sonar_0002.png": "MEASURED", "sonar_0003.png": None,
    }


def test_changing_synthetic_coordinates_never_changes_contact_grouping_or_evidence(client):
    surveys = [
        _survey(client, _bundle(mission=SEQUENTIAL_CONTRACT, provenance=V4_PROVENANCE, navigation=_navigation_csv(lat, lon, spread)))
        for lat, lon, spread in ((18.92184, 72.83466, 0.0), (15.5, 83.1, 0.0), (15.5, 83.1, 0.4))
    ]
    assert _groupings(surveys[0]) == _groupings(surveys[1]) == _groupings(surveys[2]) == [(name,) for name in NAMES]
    evidence = [sorted((contact["look_count"], contact["persistence_score"], contact["evidence_score"], contact["confidence"])
                       for contact in survey["contacts"]) for survey in surveys]
    assert evidence[0] == evidence[1] == evidence[2]


def test_synthetic_navigation_adds_nothing_to_contact_scores(client):
    """No evidence or confidence quantity differs from the same rasters uploaded with no navigation at all."""
    def scores(survey: dict) -> list[tuple]:
        return sorted((contact["look_count"], contact["persistence_score"], contact["persistence_evidence_type"],
                       contact["evidence_score"], json.dumps(contact["evidence_breakdown"], sort_keys=True), contact["confidence"])
                      for contact in survey["contacts"])
    synthetic = _survey(client, _bundle(mission=SEQUENTIAL_CONTRACT, provenance=V2_PROVENANCE, navigation=_navigation_csv()))
    without = _survey(client, _bundle(mission=SEQUENTIAL_CONTRACT))
    assert scores(synthetic) == scores(without)


def test_contradictory_provenance_declarations_are_rejected(client):
    response = _post(client, _bundle(mission={"navigation_provenance": "MEASURED"}, provenance=V4_PROVENANCE, navigation=_navigation_csv()))
    assert response.status_code == 422
    assert "navigation_provenance" in response.text


def test_invalid_declared_provenance_rejects_the_upload(client):
    response = _post(client, _bundle(mission={"navigation_provenance": "UNKNOWN"}, navigation=_navigation_csv()))
    assert response.status_code == 422
