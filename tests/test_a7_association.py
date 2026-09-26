"""Round-2 ticket A7: Survey-bounded cross-Frame association, the final rule (spec A req 2, I-A2).

Two Observations on different Frames may join one Contact only when both Frames belong to the same
Survey and share a verified ping relationship. The only verified relationship is the one Aqualens
derives from the source pixels (B4): a VERIFIED Survey whose ``ping_relationship`` is
DERIVED_FROM_SOURCE. Declared navigation, of any provenance, relates nothing. Within a verified
relationship:

  (a) overlapping ping windows: the boxes must overlap once both are placed on the Survey's ping
      axis (row + derived offset) and range axis (column). That is the same Look;
  (b) ping-contiguous, disjoint windows: |x̄₁ − x̄₂| ≤ max(0.25·min(w₁, w₂), 20 px), where x̄ is the
      box centre column and w the box width in source-raster pixel columns (PID-24). That is an
      independent Look. The 20 px floor is a pixel quantity, not a calibrated or metric distance.

Survey membership, ping-relationship eligibility, association, Looks and persistence stay distinct:
membership alone relates nothing, association in overlapping windows adds no Look, and persistence
(SEQUENTIAL_PING) requires more than one independent Look in a VERIFIED Survey.
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
from sagar.vnext import fuse_contacts

ROOT = Path(__file__).resolve().parents[1]

# ------------------------------------------------------------ association seam

RASTER = (5000, 500)
SURVEY = "survey_u.verified.frame_0000"


def _obs(frame: int, pings: tuple[int, int], box: tuple[float, float, float, float], *, survey: str = SURVEY,
         membership: str = "VERIFIED", provenance: str | None = "DERIVED_FROM_SOURCE", number: int = 0,
         raw_class: str = "PIPELINE") -> dict:
    """An Observation as ingest annotates it: its Frame's Survey and position on that Survey's ping axis."""
    width, height = RASTER
    x1, y1, x2, y2 = box
    return {"detection_id": f"det_frame_{frame:04d}_{number:04d}", "source_frame_id": f"frame_{frame:04d}", "frame_index": frame,
            "raw_class": raw_class, "raw_confidence": .4, "bbox_px": list(box),
            "bbox_normalized": [x1 / width, y1 / height, x2 / width, y2 / height], "pixel_dimensions": [width, height],
            "inference_mode": "FULL_FRAME", "tile_id": None, "geo": {"lat": None, "lon": None}, "model_sha256": "sha",
            "survey_ref": survey, "survey_membership_provenance": membership, "ping_relationship_provenance": provenance,
            "survey_ping_start": pings[0], "survey_ping_end": pings[1], "sequential_observation_supported": provenance is not None}


def _groups(observations: list[dict]) -> list[list[str]]:
    return sorted(sorted(contact["source_detection_ids"]) for contact in fuse_contacts(observations, "u"))


def _joined(observations: list[dict]) -> bool:
    return _groups(observations) == [sorted(item["detection_id"] for item in observations)]


def _box(centre: float, width: float, rows: tuple[float, float] = (100, 200)) -> tuple[float, float, float, float]:
    return (centre - width / 2, rows[0], centre + width / 2, rows[1])


CONTIGUOUS = ((0, 499), (500, 999))


def _pair(centre_a: float, width_a: float, centre_b: float, width_b: float) -> list[dict]:
    return [_obs(0, CONTIGUOUS[0], _box(centre_a, width_a)), _obs(1, CONTIGUOUS[1], _box(centre_b, width_b))]


# --- which Frames may relate at all

def test_frames_in_different_surveys_never_associate_even_with_contiguous_pings_and_matching_boxes():
    observations = [_obs(0, CONTIGUOUS[0], _box(1000, 100)), _obs(1, CONTIGUOUS[1], _box(1000, 100), survey="survey_u.verified.frame_0005")]
    assert not _joined(observations)


@pytest.mark.parametrize("provenance", ["MEASURED", "SYNTHETIC_DEMO", None])
def test_a_relationship_not_derived_from_source_never_associates(provenance):
    observations = [_obs(0, CONTIGUOUS[0], _box(1000, 100), provenance=provenance),
                    _obs(1, CONTIGUOUS[1], _box(1000, 100), provenance=provenance)]
    assert not _joined(observations)
    assert all(contact["look_count"] == 1 for contact in fuse_contacts(observations, "u"))


@pytest.mark.parametrize("membership", ["DECLARED", "SINGLETON", None])
def test_membership_other_than_verified_never_associates(membership):
    observations = [_obs(0, CONTIGUOUS[0], _box(1000, 100), membership=membership),
                    _obs(1, CONTIGUOUS[1], _box(1000, 100), membership=membership)]
    assert not _joined(observations)


def test_windows_with_a_ping_gap_never_associate():
    assert not _joined([_obs(0, (0, 499), _box(1000, 100)), _obs(1, (501, 1000), _box(1000, 100))])


def test_same_class_is_still_required():
    observations = [_obs(0, CONTIGUOUS[0], _box(1000, 100)), _obs(1, CONTIGUOUS[1], _box(1000, 100), raw_class="CRAB_POT")]
    assert not _joined(observations)


# --- (a) overlapping windows: mapped-box overlap, the same Look

def test_overlapping_windows_associate_when_mapped_boxes_overlap_and_add_no_look():
    # Frame 1 starts 20 pings later on the axis, so the same object sits 20 rows higher in it.
    observations = [_obs(0, (0, 499), (1000, 120, 1100, 220)), _obs(1, (20, 519), (1000, 100, 1100, 200))]
    (contact,) = fuse_contacts(observations, "u")
    assert contact["association_basis"] == "SAME_LOOK_OVERLAPPING_WINDOWS"
    assert contact["look_count"] == 1
    assert contact["persistence_evidence_type"] == "WINDOW_OVERLAP_ONLY"   # association is not persistence


def test_overlapping_windows_do_not_associate_when_mapped_rows_are_disjoint():
    # Same columns and centres; on the ping axis the boxes are 120-220 and 320-420.
    assert not _joined([_obs(0, (0, 499), (1000, 120, 1100, 220)), _obs(1, (200, 699), (1000, 120, 1100, 220))])


def test_overlapping_windows_use_mapped_overlap_not_the_slant_range_tolerance():
    # Centres 10 px apart (within max(0.25·w, 20)) and the same pings on the axis, but the columns
    # do not overlap: in overlapping windows that is not one Look.
    assert not _joined([_obs(0, (0, 499), (1000, 100, 1004, 200)), _obs(1, (20, 519), (1010, 80, 1014, 180))])


def test_boxes_that_only_touch_do_not_overlap():
    assert not _joined([_obs(0, (0, 499), (1000, 100, 1100, 200)), _obs(1, (20, 519), (1100, 80, 1200, 180))])


# --- (b) contiguous disjoint windows: PID-24

def test_contiguous_windows_with_a_slant_range_match_are_independent_looks_and_persistence():
    (contact,) = fuse_contacts(_pair(1000, 100, 1010, 100), "u")
    assert contact["association_basis"] == "INDEPENDENT_LOOKS_ALONG_TRACK"
    assert contact["look_count"] == 2
    assert contact["persistence_evidence_type"] == "SEQUENTIAL_PING"
    assert (contact["first_ping"], contact["last_ping"]) == (0, 999)   # Survey ping-axis indices


def test_pid24_swapping_the_two_observations_gives_the_same_result():
    for centre_b in (1024.5, 1025.0, 1025.5):
        a, b = _pair(1000, 100, centre_b, 120)
        assert _groups([a, b]) == _groups([b, a])


def test_pid24_swapping_the_two_widths_gives_the_same_result():
    for offset in (19.0, 20.0, 24.0, 25.0, 26.0, 30.0):
        assert _joined(_pair(1000, 100, 1000 + offset, 120)) == _joined(_pair(1000, 120, 1000 + offset, 100))


def test_pid24_uses_the_smaller_width():
    """w₁ = 40, w₂ = 200, centres 25 px apart. Tolerance: min → max(10, 20) = 20 (no match);
    max → 50, mean → 30, first box → 20 or 50, second box → 50 or 20 (a match under each, in one order)."""
    for first, second in ((40, 200), (200, 40)):
        assert not _joined(_pair(1000, first, 1025, second))
    # And the smaller width really sets it when it exceeds the floor: w = min(100, 400) → 25 px.
    assert _joined(_pair(1000, 100, 1025, 400)) and not _joined(_pair(1000, 100, 1026, 400))
    assert _joined(_pair(1000, 400, 1025, 100)) and not _joined(_pair(1000, 400, 1026, 100))


def test_pid24_an_oversized_box_cannot_widen_the_tolerance():
    # An 800-px box would give 0.25·800 = 200 px; with min it is max(0.25·40, 20) = 20 px.
    small, oversized = _pair(1000, 40, 1100, 800)
    assert not _joined([small, oversized]) and not _joined([oversized, small])


@pytest.mark.parametrize("offset, joined", [(19.5, True), (20.0, True), (20.5, False)])
def test_pid24_the_20_px_floor(offset, joined):
    # 0.25·min(16, 60) = 4 px, so the 20 px floor governs; the boundary itself matches (≤).
    assert _joined(_pair(1000, 16, 1000 + offset, 60)) is joined
    assert _joined(_pair(1000 + offset, 60, 1000, 16)) is joined


@pytest.mark.parametrize("offset, joined", [(24.5, True), (25.0, True), (25.5, False)])
def test_pid24_inside_on_and_outside_the_width_tolerance(offset, joined):
    # 0.25·min(100, 120) = 25 px exceeds the floor: inside, exactly on, just outside.
    assert _joined(_pair(1000, 100, 1000 + offset, 120)) is joined


def test_pid24_order_of_observations_and_frames_never_changes_the_result():
    observations = _pair(1000, 100, 1020, 140)
    expected = _groups(observations)
    reordered = [{**item, "frame_index": 7 - item["frame_index"]} for item in reversed(observations)]
    assert _groups(reordered) == expected


# --------------------------------------------------------------- runtime (API)

H, W = 60, 40
_BOXES: dict[str, list[float]] = {}
_DEFAULT_BOX = [10.0, 4.0, 20.0, 12.0]


def _fake_infer(self, image_path, survey_id, source_image_id):
    """The detector is faked; each test states where the object is in each raster."""
    with Image.open(image_path) as image:
        width, height = image.size
    x1, y1, x2, y2 = _BOXES.get(Path(image_path).name, _DEFAULT_BOX)
    finding = {
        "detection_id": f"det_{survey_id}_{source_image_id}_0000", "survey_id": survey_id,
        "source_frame_id": source_image_id, "source_image_path": str(image_path), "tile_id": None,
        "raw_class_id": 2, "raw_class": "PIPELINE", "raw_confidence": 0.42,
        "display_class": "PIPELINE", "display_confidence": 0.5, "classification_source": "MODEL",
        "production_qualified": True, "anomaly_score": None, "bbox_px": [x1, y1, x2, y2],
        "bbox_normalized": [x1 / width, y1 / height, x2 / width, y2 / height], "pixel_dimensions": [width, height],
        "geo": {"lat": None, "lon": None}, "review_state": None, "review_history": [],
        "model_id": "test_model", "model_sha256": "deadbeef", "dataset_snapshot_id": "test_snapshot",
        "run_id": f"runtime_{survey_id}", "inference_mode": "FULL_FRAME", "tile_size": None, "tile_overlap": None,
    }
    return {"width_px": width, "height_px": height, "inference_mode": "FULL_FRAME", "tile_count": 0}, [finding]


@pytest.fixture()
def client(monkeypatch, tmp_path) -> TestClient:
    _BOXES.clear()
    monkeypatch.setattr(FinalDetector, "infer", _fake_infer)
    monkeypatch.setenv("SAGARDRISHTI_RUNTIME_DIR", str(tmp_path / "runtime"))
    return TestClient(create_app(ROOT))


def _png(pixels: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PNG")
    return buffer.getvalue()


def _waterfall_frames(starts: dict[str, int], seed: int = 3) -> dict[str, bytes]:
    """Frame ``name`` holds waterfall rows [start, start + H): consecutive Frames share pings (B4)."""
    waterfall = np.random.default_rng(seed).integers(0, 256, (max(starts.values()) + H, W, 3), dtype=np.uint8)
    return {name: _png(waterfall[start:start + H]) for name, start in starts.items()}


def _upload(client: TestClient, entries: dict[str, bytes | str], order: list[str] | None = None) -> dict:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name in order or list(entries):
            archive.writestr(name, entries[name])
    response = client.post("/api/v1/surveys/upload", files={"file": ("bundle.zip", buffer.getvalue(), "application/zip")})
    assert response.status_code == 200, response.text
    body = response.json()
    deadline = time.monotonic() + 60
    while client.get(f"/api/v1/jobs/{body['job_id']}").json()["state"] not in {"COMPLETED", "FAILED"}:
        assert time.monotonic() < deadline
        time.sleep(0.02)
    return client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()


def _relationships(survey: dict, label: dict[str, str] | None = None) -> list[tuple]:
    """Contacts by raster (or content label): members, basis, Looks, persistence."""
    names = {frame["frame_id"]: Path(frame["source_path"]).name for frame in survey["frames"]}
    label = label or {}
    return sorted((tuple(sorted(label.get(names[f], names[f]) for f in contact["source_frame_ids"])), contact["association_basis"],
                   contact["look_count"], contact["persistence_evidence_type"]) for contact in survey["contacts"])


# Three Frames 30 pings apart: f00 and f60 are ping-contiguous and disjoint, each overlaps f30.
_CHAIN = {"f00.png": 0, "f30.png": 30, "f60.png": 60}


def test_verified_frames_associate_as_one_look_only_when_their_mapped_boxes_overlap(client):
    """A-AC5. The object sits at waterfall rows 45-55, so at row 45 - start in each Frame."""
    starts = {"a.png": 0, "b.png": 20, "c.png": 40}
    for name, start in starts.items():
        _BOXES[name] = [10.0, 45.0 - start, 20.0, 55.0 - start]
    survey = _upload(client, _waterfall_frames(starts))
    assert [item["membership_provenance"] for item in survey["surveys"]] == ["VERIFIED"]
    assert _relationships(survey) == [(("a.png", "b.png", "c.png"), "SAME_LOOK_OVERLAPPING_WINDOWS", 1, "WINDOW_OVERLAP_ONLY")]
    assert all(f["ping_relationship_provenance"] == "DERIVED_FROM_SOURCE" and f["sequential_observation_supported"] for f in survey["findings"])


def test_verified_frames_with_non_overlapping_mapped_boxes_stay_separate(client):
    """Survey membership and a verified relationship are not association: rows 4-12 in every Frame
    are different pings on the Survey axis."""
    survey = _upload(client, _waterfall_frames({"a.png": 0, "b.png": 20, "c.png": 40}))
    assert _relationships(survey) == [((name,), "SINGLE", 1, "SINGLE_OBSERVATION") for name in ("a.png", "b.png", "c.png")]


def test_contiguous_disjoint_verified_frames_form_independent_looks_and_persistence(client):
    """A-AC6. f00 and f60 are pixel-disjoint and ping-contiguous (through f30); same range column."""
    survey = _upload(client, _waterfall_frames(_CHAIN))
    assert _relationships(survey) == [
        (("f00.png", "f60.png"), "INDEPENDENT_LOOKS_ALONG_TRACK", 2, "SEQUENTIAL_PING"),
        (("f30.png",), "SINGLE", 1, "SINGLE_OBSERVATION"),
    ]


def test_contiguous_frames_outside_the_slant_range_tolerance_stay_separate(client):
    _BOXES["f60.png"] = [31.5, 4.0, 39.5, 12.0]   # centre 35.5 vs 15: 20.5 px > max(0.25·min(10, 8), 20)
    survey = _upload(client, _waterfall_frames(_CHAIN))
    assert all(contact["look_count"] == 1 for contact in survey["contacts"])


def test_a_duplicate_raster_never_adds_a_look_and_fails_the_relationship_closed(client):
    """A byte-identical copy of f60 makes both copies DUPLICATE_RASTER; neither is verified, so the
    f00-f60 independent Look (see the test above) is not formed."""
    rasters = _waterfall_frames(_CHAIN)
    survey = _upload(client, {**rasters, "f60_copy.png": rasters["f60.png"]})
    assert all(contact["look_count"] == 1 for contact in survey["contacts"])
    duplicates = {Path(f["source_path"]).name for f in survey["frames"] if f["raster_duplicate_status"] == "DUPLICATE_RASTER"}
    assert duplicates == {"f60.png", "f60_copy.png"}


def _contiguous_navigation(names: list[str]) -> str:
    return "frame,timestamp_utc,latitude,longitude,heading_deg,ping_start,ping_end\n" + "".join(
        f"{name},2026-09-01T15:30:{index:02d}Z,18.92184,72.83466,128.4,{120000 + index * 800},{120799 + index * 800}\n"
        for index, name in enumerate(names))


@pytest.mark.parametrize("mission", [
    {"sequence_mode": "SEQUENTIAL_PING", "sequential_ping_evidence": True, "navigation_provenance": "MEASURED"},
    {"sequence_mode": "SEQUENTIAL_PING", "sequential_ping_evidence": True},
], ids=["measured", "null"])
def test_declared_navigation_and_declared_membership_alone_relate_nothing(client, mission):
    """Unrelated rasters, contiguous declared pings, a declared sequence and a DECLARED Survey."""
    rng = np.random.default_rng(9)
    rasters = {f"s{index}.png": _png(rng.integers(0, 256, (H, W, 3), dtype=np.uint8)) for index in range(3)}
    names = sorted(rasters)
    survey = _upload(client, {**rasters, "navigation.csv": _contiguous_navigation(names),
                              "mission.json": json.dumps({**mission, "declared_surveys": [names]})})
    assert [item["membership_provenance"] for item in survey["surveys"]] == ["DECLARED"]
    assert _relationships(survey) == [((name,), "SINGLE", 1, "SINGLE_OBSERVATION") for name in names]
    assert not any(f["sequential_observation_supported"] for f in survey["findings"])


def test_declared_membership_takes_verifiable_frames_out_of_any_relationship(client):
    rasters = _waterfall_frames(_CHAIN)
    survey = _upload(client, {**rasters, "mission.json": json.dumps({"declared_surveys": [sorted(rasters)]})})
    assert all(contact["look_count"] == 1 for contact in survey["contacts"])


def test_synthetic_navigation_neither_creates_nor_changes_relationships(client):
    rasters = _waterfall_frames(_CHAIN)
    plain = _relationships(_upload(client, rasters))
    synthetic = _relationships(_upload(client, {
        **rasters, "navigation.csv": _contiguous_navigation(sorted(rasters, reverse=True)),
        "mission.json": json.dumps({"sequence_mode": "SEQUENTIAL_PING", "sequential_ping_evidence": True}),
        "provenance.json": json.dumps({"navigation_source": "SYNTHETIC_DEMO_NAVIGATION"}),
    }))
    assert synthetic == plain


def test_upload_order_and_file_names_never_change_relationships(client):
    rasters = _waterfall_frames(_CHAIN)
    baseline = _relationships(_upload(client, rasters))
    # Rename so file-name order runs against ping order, and reverse the ZIP order.
    renamed = {"z_first.png": rasters["f00.png"], "m_second.png": rasters["f30.png"], "a_third.png": rasters["f60.png"]}
    label = {"z_first.png": "f00.png", "m_second.png": "f30.png", "a_third.png": "f60.png"}
    _BOXES.update({name: _DEFAULT_BOX for name in renamed})
    reordered = _upload(client, renamed, order=["a_third.png", "z_first.png", "m_second.png"])
    assert _relationships(reordered, label) == baseline
