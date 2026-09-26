"""Pre-A7 closure: rebuilding stored records follows the ingest rules, and DERIVED_FROM_SOURCE is system-only.

When the runtime starts it rebuilds what old stored records lack: Contacts for records written before
Contacts existed, and Survey membership for records written before Surveys existed. That rebuild must
not be a second, weaker path. It uses the canonical B2 duplicate-raster rule, B3 provenance resolution
and the B4 verifier with B5 geometry partitioning, and fails closed when source rasters or metadata are
missing or no longer acceptable. An uploader can never declare DERIVED_FROM_SOURCE.

Since A7, Frames relate only through the ping relationship derived from their pixels (B4) within one
Survey. Tests that must show a guard is load-bearing use a stored chain of three Frames whose first and
last are pixel-disjoint and ping-contiguous (``_CHAIN``): with its rasters readable and unique, the rebuild
forms one independent Look between them.
"""
from __future__ import annotations

import copy
import hashlib
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
UPLOAD = "survey_upload_stored"
SEQUENTIAL = {"sequence_mode": "SEQUENTIAL_PING", "sequential_ping_evidence": True}


def _finding(survey_id: str, frame_id: str, path: Path, width: int, height: int) -> dict:
    return {
        "detection_id": f"det_{survey_id}_{frame_id}_0000", "survey_id": survey_id,
        "source_frame_id": frame_id, "source_image_path": str(path), "tile_id": None,
        "raw_class_id": 2, "raw_class": "PIPELINE", "raw_confidence": 0.42,
        "display_class": "PIPELINE", "display_confidence": 0.5, "classification_source": "MODEL",
        "production_qualified": True, "anomaly_score": None, "bbox_px": [4.0, 4.0, 12.0, 12.0],
        "bbox_normalized": [4.0 / width, 4.0 / height, 12.0 / width, 12.0 / height], "pixel_dimensions": [width, height],
        "geo": {"lat": None, "lon": None}, "review_state": None, "review_history": [],
        "model_id": "test_model", "model_sha256": "deadbeef", "dataset_snapshot_id": "test_snapshot",
        "run_id": f"runtime_{survey_id}", "inference_mode": "FULL_FRAME", "tile_size": None, "tile_overlap": None,
    }


def _fake_infer(self, image_path, survey_id, source_image_id):
    with Image.open(image_path) as image:
        width, height = image.size
    return ({"width_px": width, "height_px": height, "inference_mode": "FULL_FRAME", "tile_count": 0},
            [_finding(survey_id, source_image_id, Path(image_path), width, height)])


@pytest.fixture()
def runtime_dir(tmp_path) -> Path:
    return tmp_path / "runtime"


def _app(monkeypatch, runtime_dir: Path) -> TestClient:
    monkeypatch.setattr(FinalDetector, "infer", _fake_infer)
    monkeypatch.setenv("SAGARDRISHTI_RUNTIME_DIR", str(runtime_dir))
    return TestClient(create_app(ROOT))


def _png(pixels: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PNG")
    return buffer.getvalue()


def _textured(seed: int, size: tuple[int, int] = (40, 60)) -> bytes:
    width, height = size
    return _png(np.random.default_rng(seed).integers(0, 256, (height, width, 3), dtype=np.uint8))


def _row_shifted(count: int, k: int = 10, seed: int = 40) -> list[bytes]:
    """Frames of one waterfall, each k rows after the next: element 0 holds the newest pings."""
    waterfall = np.random.default_rng(seed).integers(0, 256, (60 + k * (count - 1), 40, 3), dtype=np.uint8)
    return [_png(waterfall[index * k:index * k + 60]) for index in range(count)]


def _chain() -> dict[str, bytes]:
    """c0, c1, c2 are 30 pings apart: c0 and c2 are ping-contiguous and disjoint, each overlaps c1."""
    return dict(zip(("c0.png", "c1.png", "c2.png"), _row_shifted(3, k=30)))


# The rebuilt Contacts of an intact _chain(): c0 and c2 form one independent Look (same box column).
_CHAIN_LOOKS = [(1, "SINGLE_OBSERVATION"), (2, "SEQUENTIAL_PING")]


def _navigation(names: list[str]) -> str:
    """Contiguous, disjoint declared ping bounds in file-name order."""
    return "frame,timestamp_utc,latitude,longitude,heading_deg,ping_start,ping_end\n" + "".join(
        f"{name},2026-09-01T15:30:{index:02d}Z,18.92184,72.83466,128.4,{120000 + index * 800},{120799 + index * 800}\n"
        for index, name in enumerate(names)
    )


def _write_stored(tmp_path: Path, runtime_dir: Path, rasters: dict[str, bytes | None], *, mission: dict | None = None,
                  provenance: dict | None = None, navigation: bool = True, with_contacts: bool = False,
                  reverse: bool = False) -> dict:
    """A retained record written before Contacts and Surveys existed, with its bundle on disk.

    A raster given as None is listed in the record but absent from disk.
    """
    bundle = tmp_path / "uploads" / "upload_stored"
    bundle.mkdir(parents=True, exist_ok=True)
    names = sorted(rasters)
    frames, findings = [], []
    for index, name in enumerate(names):
        path, frame_id = bundle / name, f"frame_{index:04d}"
        if rasters[name] is not None:
            path.write_bytes(rasters[name])
        frames.append({"frame_id": frame_id, "source_path": str(path), "width_px": 40, "height_px": 60, "inference_mode": "FULL_FRAME",
                       "tile_count": 0, "navigation": {"navigation_status": "AVAILABLE" if navigation else "UNAVAILABLE"}, "sonar_condition": {}})
        findings.append(_finding(UPLOAD, frame_id, path, 40, 60))
    if navigation:
        (bundle / "navigation.csv").write_text(_navigation(names))
    if mission is not None:
        (bundle / "mission.json").write_text(json.dumps(mission))
    if provenance is not None:
        (bundle / "provenance.json").write_text(json.dumps(provenance))
    if reverse:
        frames.reverse()
        findings.reverse()
    record = {"survey_id": UPLOAD, "name": "stored", "created_at": "2026-09-01T00:00:00+00:00", "frames": frames, "findings": findings,
              "navigation_status": "AVAILABLE" if navigation else "UNAVAILABLE", "mission": None}
    if with_contacts:
        record.update({"contacts": [], "model_registry": {}, "contact_fusion_policy": "contact_fusion@v1", "sequential_observation_contract": False})
    runtime_dir.mkdir(parents=True, exist_ok=True)
    (runtime_dir / "runtime_surveys.json").write_text(json.dumps({UPLOAD: record}))
    return record


def _record(client: TestClient, survey_id: str = UPLOAD) -> dict:
    return client.get(f"/api/v1/runtime/surveys/{survey_id}").json()


def _names(record: dict) -> dict[str, str]:
    return {frame["frame_id"]: Path(frame["source_path"]).name for frame in record["frames"]}


def _looks(record: dict) -> list[tuple[int, str]]:
    return sorted((contact["look_count"], contact["persistence_evidence_type"]) for contact in record["contacts"])


def _memberships(record: dict) -> list[tuple]:
    names = _names(record)
    return sorted((item["membership_provenance"], tuple(names[f] for f in item["frame_ids"]),
                   tuple(sorted((names[f], offset) for f, offset in (item.get("ping_relationship") or {}).get("ping_offsets", {}).items())),
                   (item.get("ping_relationship") or {}).get("provenance")) for item in record["surveys"])


# ------------------------------------------------ 1. B2 on the rebuild path

def test_control_rebuild_of_a_verified_chain_forms_an_independent_look(monkeypatch, tmp_path, runtime_dir):
    """Shows the rebuild path can form Looks at all, so the guards below are load-bearing."""
    _write_stored(tmp_path, runtime_dir, _chain())
    assert _looks(_record(_app(monkeypatch, runtime_dir))) == _CHAIN_LOOKS


def test_byte_identical_stored_rasters_never_become_independent_looks_after_rebuild(monkeypatch, tmp_path, runtime_dir):
    chain = _chain()
    _write_stored(tmp_path, runtime_dir, {**chain, "c2_copy.png": chain["c2.png"]},
                  mission={**SEQUENTIAL, "navigation_provenance": "MEASURED"})
    record = _record(_app(monkeypatch, runtime_dir))
    status = {Path(frame["source_path"]).name: frame["raster_duplicate_status"] for frame in record["frames"]}
    assert status == {"c0.png": "UNIQUE", "c1.png": "UNIQUE", "c2.png": "DUPLICATE_RASTER", "c2_copy.png": "DUPLICATE_RASTER"}
    assert {frame["raster_sha256"] for frame in record["frames"] if frame["raster_duplicate_status"] == "DUPLICATE_RASTER"} == {
        hashlib.sha256(chain["c2.png"]).hexdigest()}
    assert _looks(record) == [(1, "SINGLE_OBSERVATION")] * 4


# ------------------------------------ 2. rebuild without source pixels fails closed

def test_stored_record_without_source_pixels_forms_no_looks_and_no_verified_survey(monkeypatch, tmp_path, runtime_dir):
    """The intact-chain record (see the control) with ping bounds, a declared sequence, MEASURED
    provenance and names, but without its rasters."""
    _write_stored(tmp_path, runtime_dir, {name: None for name in _chain()},
                  mission={**SEQUENTIAL, "navigation_provenance": "MEASURED"})
    record = _record(_app(monkeypatch, runtime_dir))
    assert _looks(record) == [(1, "SINGLE_OBSERVATION")] * 3
    assert {frame["raster_duplicate_status"] for frame in record["frames"]} == {None}  # not established
    assert [item["membership_provenance"] for item in record["surveys"]] == ["SINGLETON"] * 3
    assert all("ping_relationship" not in item for item in record["surveys"])


def test_one_missing_raster_cannot_take_part_in_a_verified_survey(monkeypatch, tmp_path, runtime_dir):
    frames = _row_shifted(3)
    _write_stored(tmp_path, runtime_dir, {"s0.png": frames[0], "s1.png": frames[1], "s2.png": None}, with_contacts=True)
    record = _record(_app(monkeypatch, runtime_dir))
    assert [(m, n) for m, n, *_ in _memberships(record)] == [("SINGLETON", ("s2.png",)), ("VERIFIED", ("s0.png", "s1.png"))]


# ------------------------------- 3. rebuild with valid pixels uses the ingest verifier

def _fresh_upload(client: TestClient, rasters: dict[str, bytes]) -> dict:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in rasters.items():
            archive.writestr(name, content)
    body = client.post("/api/v1/surveys/upload", files={"file": ("bundle.zip", buffer.getvalue(), "application/zip")}).json()
    deadline = time.monotonic() + 60
    while client.get(f"/api/v1/jobs/{body['job_id']}").json()["state"] not in {"COMPLETED", "FAILED"}:
        assert time.monotonic() < deadline
        time.sleep(0.02)
    return _record(client, body["survey_id"])


@pytest.mark.parametrize("with_contacts", [False, True], ids=["contacts_rebuilt", "contacts_retained"])
def test_stored_record_with_verifiable_pixels_gets_the_same_membership_as_fresh_ingest(monkeypatch, tmp_path, runtime_dir, with_contacts):
    shifted = _row_shifted(3)
    rasters = {"s0.png": shifted[0], "s1.png": shifted[1], "s2.png": shifted[2], "x.png": _textured(9)}
    _write_stored(tmp_path, runtime_dir, rasters, with_contacts=with_contacts)
    client = _app(monkeypatch, runtime_dir)
    rebuilt = _record(client)
    fresh = _fresh_upload(client, rasters)
    assert _memberships(rebuilt) == _memberships(fresh) == [
        ("SINGLETON", ("x.png",), (), None),
        ("VERIFIED", ("s0.png", "s1.png", "s2.png"), (("s0.png", 0), ("s1.png", 10), ("s2.png", 20)), "DERIVED_FROM_SOURCE"),
    ]
    # Verified membership is not association: the fixed box (rows 4-12) is different pings in each
    # Frame on the Survey axis, and s0-s2 are not ping-contiguous.
    assert _looks(rebuilt) == ([] if with_contacts else [(1, "SINGLE_OBSERVATION")] * 4)


def test_rebuild_applies_the_ingest_geometry_partition(monkeypatch, tmp_path, runtime_dir):
    """A palette Frame and an RGBA Frame with identical expanded pixels never share a Survey (I-B2)."""
    rng = np.random.default_rng(5)
    index = rng.integers(0, 256, (70, 40), dtype=np.uint8)
    palette = list(rng.integers(0, 256, 768, dtype=np.uint8))

    def palette_frame(start: int) -> Image.Image:
        image = Image.fromarray(index[start:start + 60], mode="P")
        image.putpalette(palette)
        return image

    def encode(image: Image.Image) -> bytes:
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    _write_stored(tmp_path, runtime_dir, {"a.png": encode(palette_frame(0)), "b.png": encode(palette_frame(10).convert("RGBA"))},
                  with_contacts=True)
    assert [m for m, *_ in _memberships(_record(_app(monkeypatch, runtime_dir)))] == ["SINGLETON", "SINGLETON"]


def test_rebuild_never_verifies_from_ping_bounds_names_or_order(monkeypatch, tmp_path, runtime_dir):
    """Contiguous declared pings and sequential names, but unrelated pixels: nothing is verified."""
    _write_stored(tmp_path, runtime_dir, {"s0.png": _textured(1), "s1.png": _textured(2), "s2.png": _textured(3)},
                  mission={**SEQUENTIAL, "navigation_provenance": "MEASURED"}, with_contacts=True)
    assert [m for m, *_ in _memberships(_record(_app(monkeypatch, runtime_dir)))] == ["SINGLETON"] * 3


# ----------------------------- 4. DERIVED_FROM_SOURCE is produced by Aqualens only

def _write(tmp_path: Path, name: str, value: dict) -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(value))
    return path


def test_uploader_declared_derived_from_source_is_rejected_by_the_parsers(tmp_path):
    with pytest.raises(NavigationValidationError) as mission_error:
        parse_mission_json(_write(tmp_path, "mission.json", {"navigation_provenance": "DERIVED_FROM_SOURCE"}))
    assert mission_error.value.field == "navigation_provenance"
    for key in ("navigation_provenance", "navigation_source"):
        with pytest.raises(NavigationValidationError) as bundle_error:
            parse_bundle_provenance(_write(tmp_path, "provenance.json", {key: "DERIVED_FROM_SOURCE"}))
        assert bundle_error.value.field == "navigation_provenance"


@pytest.mark.parametrize("entry", [
    ("mission.json", {"navigation_provenance": "DERIVED_FROM_SOURCE"}),
    ("provenance.json", {"navigation_provenance": "DERIVED_FROM_SOURCE"}),
], ids=["mission", "provenance"])
def test_upload_declaring_derived_from_source_is_rejected(monkeypatch, runtime_dir, entry):
    client = _app(monkeypatch, runtime_dir)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("a.png", _textured(1))
        archive.writestr(entry[0], json.dumps(entry[1]))
    response = client.post("/api/v1/surveys/upload", files={"file": ("bundle.zip", buffer.getvalue(), "application/zip")})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"
    assert response.json()["error"]["detail"]["field"] == "navigation_provenance"
    assert client.get("/api/v1/runtime/surveys").json()["total"] == 0


def test_stored_bundle_declaring_derived_from_source_rebuilds_fail_closed(monkeypatch, tmp_path, runtime_dir):
    """An uploader's DERIVED_FROM_SOURCE declaration is metadata ingest rejects; on rebuild it fails
    closed, and declared provenance never relates Frames in any case (A7)."""
    _write_stored(tmp_path, runtime_dir, {"s0.png": _textured(1), "s1.png": _textured(2), "s2.png": _textured(3)},
                  mission={**SEQUENTIAL, "navigation_provenance": "DERIVED_FROM_SOURCE"})
    record = _record(_app(monkeypatch, runtime_dir))  # startup does not fail on metadata ingest would now reject
    assert _looks(record) == [(1, "SINGLE_OBSERVATION")] * 3
    assert {item["navigation_provenance"] for item in record["surveys"]} == {None}


@pytest.mark.parametrize("provenance, expected", [
    ({"navigation_source": "SYNTHETIC_DEMO_NAVIGATION"}, "SYNTHETIC_DEMO"),
    (None, None),
], ids=["synthetic_demo", "null"])
def test_rebuild_resolves_provenance_like_ingest_and_keeps_it_non_evidence(monkeypatch, tmp_path, runtime_dir, provenance, expected):
    _write_stored(tmp_path, runtime_dir, {"s0.png": _textured(1), "s1.png": _textured(2), "s2.png": _textured(3)},
                  mission=SEQUENTIAL, provenance=provenance)
    record = _record(_app(monkeypatch, runtime_dir))
    assert {item["navigation_provenance"] for item in record["surveys"]} == {expected}
    assert _looks(record) == [(1, "SINGLE_OBSERVATION")] * 3


def test_measured_on_rebuild_is_carried_as_a_declaration_only(monkeypatch, tmp_path, runtime_dir):
    _write_stored(tmp_path, runtime_dir, {"s0.png": _textured(1), "s1.png": _textured(2), "s2.png": _textured(3)},
                  mission={**SEQUENTIAL, "navigation_provenance": "MEASURED"})
    record = _record(_app(monkeypatch, runtime_dir))
    assert {item["navigation_provenance"] for item in record["surveys"]} == {"MEASURED"}
    assert [m for m, *_ in _memberships(record)] == ["SINGLETON"] * 3
    assert _looks(record) == [(1, "SINGLE_OBSERVATION")] * 3


# ------------------------------------- 5. restarts and stored order change nothing

def test_restarting_never_increases_look_count_persistence_or_membership(monkeypatch, tmp_path, runtime_dir):
    raster = _textured(1)
    shifted = _row_shifted(2)
    _write_stored(tmp_path, runtime_dir, {"d0.png": raster, "d1.png": raster, "s0.png": shifted[0], "s1.png": shifted[1]},
                  mission={**SEQUENTIAL, "navigation_provenance": "MEASURED"})
    first = _record(_app(monkeypatch, runtime_dir))
    fresh = _fresh_upload(_app(monkeypatch, runtime_dir), {"a.png": _textured(4), "b.png": _textured(5)})
    for _ in range(2):
        client = _app(monkeypatch, runtime_dir)
        assert _record(client) == first
        assert _record(client, fresh["survey_id"]) == fresh


def test_stored_frame_and_finding_order_does_not_change_the_rebuild(monkeypatch, tmp_path, runtime_dir):
    raster = _textured(1)
    rasters = {**_chain(), "d0.png": raster, "d1.png": raster, "x.png": _textured(7)}
    results = []
    for reverse in (False, True):
        _write_stored(tmp_path, runtime_dir, rasters, mission={**SEQUENTIAL, "navigation_provenance": "MEASURED"}, reverse=reverse)
        record = _record(_app(monkeypatch, runtime_dir))
        names = _names(record)
        results.append((
            _memberships(record),
            sorted((names[f["frame_id"]], f["raster_duplicate_status"]) for f in record["frames"]),
            sorted((contact["contact_id"], contact["look_count"], contact["persistence_evidence_type"]) for contact in record["contacts"]),
        ))
    assert results[0] == results[1]
    assert sorted(looks for _, looks, _ in results[0][2]) == [1, 1, 1, 1, 2]  # the chain's independent Look forms both ways
