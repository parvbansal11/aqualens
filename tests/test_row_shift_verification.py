"""Round-2 ticket B4: VERIFIED Survey membership from exact row-shift identity (spec B rule 3b, B-AC3).

In waterfall exports such as SubPipe, rows are pings: a later Frame repeats the earlier Frame's pings
shifted by k rows (``B[k:] == A[:-k]``; k = 20 on SubPipe). That identity, confirmed pixel for pixel,
is evidence that the Frames share pings; file names and upload order never are. A verified group gets
ping offsets derived from the source (DERIVED_FROM_SOURCE). Verification is membership, not
association: since A7 it places Frames on the Survey ping axis, and association follows spec A req 2.
"""
from __future__ import annotations

import random

import numpy as np
import pytest

from sagar.vnext.surveys import RowShiftPolicy, verify_row_shift_groups

H, W = 60, 40


def _waterfall(rows: int, seed: int = 0, channels: int | None = 3) -> np.ndarray:
    shape = (rows, W) if channels is None else (rows, W, channels)
    return np.random.default_rng(seed).integers(0, 256, shape, dtype=np.uint8)


def _frames_from(waterfall: np.ndarray, starts: dict[str, int], height: int = H) -> dict[str, np.ndarray]:
    """Frame ``name`` holds waterfall rows [start, start + height): its row 0 is waterfall row ``start``."""
    return {name: waterfall[start:start + height].copy() for name, start in starts.items()}


def _verify(frames: dict[str, np.ndarray], policy: RowShiftPolicy = RowShiftPolicy()) -> list[dict]:
    return verify_row_shift_groups(list(frames), frames.__getitem__, policy)


# ------------------------------------------------------------- verified cases

@pytest.mark.parametrize("k", [1, 7, 20, H // 2])
def test_frame_shifted_by_k_rows_forms_one_verified_group_with_offset_k(k):
    frames = _frames_from(_waterfall(H + k), {"earlier": k, "later": 0})
    assert np.array_equal(frames["later"][k:], frames["earlier"][:-k])  # the SubPipe shape
    (group,) = _verify(frames)
    assert group["frame_ids"] == ["later", "earlier"]
    assert group["ping_offsets"] == {"later": 0, "earlier": k}
    assert group["verified_pairs"] == [{"frame_ids": ["later", "earlier"], "row_shift": k}]


def test_three_consecutive_frames_chain_into_one_group_with_consistent_offsets():
    frames = _frames_from(_waterfall(H + 40), {"f0": 40, "f1": 20, "f2": 0})
    (group,) = _verify(frames)
    assert group["frame_ids"] == ["f2", "f1", "f0"]
    assert group["ping_offsets"] == {"f2": 0, "f1": 20, "f0": 40}


def test_single_channel_frames_verify_like_colour_frames():
    frames = _frames_from(_waterfall(H + 5, channels=None), {"a": 5, "b": 0})
    (group,) = _verify(frames)
    assert group["ping_offsets"] == {"b": 0, "a": 5}


def test_input_order_and_names_never_change_the_result():
    waterfall = _waterfall(H + 60, seed=3)
    # Names deliberately sort against ping order; a second, unrelated recording rides along.
    starts = {"zz_first": 60, "mm_second": 40, "aa_third": 20, "b_fourth": 0}
    frames = {**_frames_from(waterfall, starts), "unrelated": _waterfall(H, seed=99)}
    expected = _verify(frames)
    (group,) = expected
    assert group["ping_offsets"] == {"b_fourth": 0, "aa_third": 20, "mm_second": 40, "zz_first": 60}
    ids = list(frames)
    for seed in range(5):
        random.Random(seed).shuffle(ids)
        assert verify_row_shift_groups(ids, frames.__getitem__) == expected


def test_two_separate_recordings_form_two_groups():
    first = _frames_from(_waterfall(H + 10, seed=1), {"a0": 10, "a1": 0})
    second = _frames_from(_waterfall(H + 10, seed=2), {"b0": 10, "b1": 0})
    groups = _verify({**first, **second})
    assert [group["frame_ids"] for group in groups] == [["a1", "a0"], ["b1", "b0"]]


# ---------------------------------------------------- false-positive guards

def test_unrelated_frames_stay_unverified():
    assert _verify({"a": _waterfall(H, seed=1), "b": _waterfall(H, seed=2), "c": _waterfall(H, seed=3)}) == []


def test_one_changed_pixel_in_the_overlap_breaks_the_identity():
    frames = _frames_from(_waterfall(H + 20), {"earlier": 20, "later": 0})
    frames["earlier"][H // 2, W // 2, 0] ^= 0xFF
    assert _verify(frames) == []


def test_pixel_identical_frames_are_not_a_row_shift():
    frame = _waterfall(H)
    assert _verify({"a": frame, "b": frame.copy()}) == []


def test_uniform_frames_are_ambiguous_and_stay_unverified():
    assert _verify({"a": np.zeros((H, W, 3), np.uint8), "b": np.zeros((H, W, 3), np.uint8)}) == []
    assert _verify({"a": np.full((H, W, 3), 9, np.uint8), "b": np.full((H, W, 3), 200, np.uint8)}) == []


def test_row_periodic_frames_match_at_several_shifts_and_stay_unverified():
    period = np.tile(_waterfall(4), (H // 4 + 3, 1, 1))
    frames = _frames_from(period, {"earlier": 4, "later": 0})
    assert np.array_equal(frames["later"][4:], frames["earlier"][:-4])  # an exact 4-row shift exists...
    assert _verify(frames) == []                                        # ...but so do 8, 12, ...: ambiguous


def test_shift_beyond_the_minimum_overlap_stays_unverified():
    k = H // 2 + 1  # overlap below half the Frame
    frames = _frames_from(_waterfall(H + k), {"earlier": k, "later": 0})
    assert np.array_equal(frames["later"][k:], frames["earlier"][:-k])
    assert _verify(frames) == []


def test_column_shift_is_not_a_row_shift():
    waterfall = _waterfall(H, seed=5)
    shifted = np.roll(waterfall, 3, axis=1)
    assert _verify({"a": waterfall, "b": shifted}) == []


@pytest.mark.parametrize("other", [
    lambda frame: np.concatenate([frame, frame[:, :1]], axis=1),  # different width
    lambda frame: frame[:, :, 0],                                  # different channel layout
], ids=["width", "channels"])
def test_frames_of_different_geometry_are_never_compared(other):
    frames = _frames_from(_waterfall(H + 10), {"earlier": 10, "later": 0})
    frames["earlier"] = other(frames["earlier"])
    assert _verify(frames) == []



# --------------------------------------------------------------- runtime (API)

import io
import json
import time
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from sagar.api import create_app
from sagar.perception.runtime import FinalDetector

ROOT = Path(__file__).resolve().parents[1]


def _fake_infer(self, image_path, survey_id, source_image_id):
    """The same box on every Frame, so any ping relationship would chain the Frames into one Contact."""
    with Image.open(image_path) as image:
        width, height = image.size
    finding = {
        "detection_id": f"det_{survey_id}_{source_image_id}_0000", "survey_id": survey_id,
        "source_frame_id": source_image_id, "source_image_path": str(image_path), "tile_id": None,
        "raw_class_id": 2, "raw_class": "PIPELINE", "raw_confidence": 0.42,
        "display_class": "PIPELINE", "display_confidence": 0.5, "classification_source": "MODEL",
        "production_qualified": True, "anomaly_score": None, "bbox_px": [4.0, 4.0, 12.0, 12.0],
        "bbox_normalized": [4.0 / width, 4.0 / height, 12.0 / width, 12.0 / height], "pixel_dimensions": [width, height],
        "geo": {"lat": None, "lon": None}, "review_state": None, "review_history": [],
        "model_id": "test_model", "model_sha256": "deadbeef", "dataset_snapshot_id": "test_snapshot",
        "run_id": f"runtime_{survey_id}", "inference_mode": "FULL_FRAME", "tile_size": None, "tile_overlap": None,
    }
    return {"width_px": width, "height_px": height, "inference_mode": "FULL_FRAME", "tile_count": 0}, [finding]


@pytest.fixture()
def client(monkeypatch, tmp_path) -> TestClient:
    monkeypatch.setattr(FinalDetector, "infer", _fake_infer)
    monkeypatch.setenv("SAGARDRISHTI_RUNTIME_DIR", str(tmp_path / "runtime"))
    return TestClient(create_app(ROOT))


def _png(pixels: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PNG")
    return buffer.getvalue()


def _upload(client: TestClient, rasters: dict[str, bytes], mission: dict | None = None, navigation: str | None = None) -> dict:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in rasters.items():
            archive.writestr(name, content)
        if mission is not None:
            archive.writestr("mission.json", json.dumps(mission))
        if navigation is not None:
            archive.writestr("navigation.csv", navigation)
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
    return client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()


def _by_name(survey: dict) -> dict[str, dict]:
    return {Path(frame["source_path"]).name: frame for frame in survey["frames"]}


def _survey_of(survey: dict, frame: dict) -> dict:
    (entry,) = [item for item in survey["surveys"] if item["survey_ref"] == frame["survey_ref"]]
    assert frame["frame_id"] in entry["frame_ids"]
    return entry


# SubPipe-like: three 1-s Frames, 20 new pings each, named so filename order runs against ping order.
_SUBPIPE_LIKE = _frames_from(_waterfall(H + 40, seed=11), {"c_oldest.png": 40, "b_middle.png": 20, "a_newest.png": 0})


def test_upload_of_row_shifted_frames_forms_one_verified_survey_derived_from_source(client):
    survey = _upload(client, {name: _png(pixels) for name, pixels in _SUBPIPE_LIKE.items()})
    frames = _by_name(survey)
    (verified,) = [item for item in survey["surveys"] if item["membership_provenance"] == "VERIFIED"]
    assert len(survey["surveys"]) == 1
    assert all(_survey_of(survey, frame) is verified for frame in frames.values())  # I-B1
    ids = {name: frame["frame_id"] for name, frame in frames.items()}
    assert verified["frame_ids"] == [ids["a_newest.png"], ids["b_middle.png"], ids["c_oldest.png"]]
    relationship = verified["ping_relationship"]
    assert relationship["provenance"] == "DERIVED_FROM_SOURCE"
    assert relationship["method"] == "ROW_SHIFT_IDENTITY"
    assert relationship["ping_offsets"] == {ids["a_newest.png"]: 0, ids["b_middle.png"]: 20, ids["c_oldest.png"]: 40}
    assert {pair["row_shift"] for pair in relationship["verified_pairs"]} <= {20, 40}
    assert verified["geometry_signature"] == {"width_px": W, "height_px": H, "channel_layout": "RGB"}
    # No navigation was declared, so navigation provenance is not derived: it stays null.
    assert verified["navigation_provenance"] is None


def test_verified_survey_keeps_declared_navigation_provenance_separate_from_its_ping_relationship(client):
    names = sorted(_SUBPIPE_LIKE, key=lambda name: -{"c_oldest.png": 40, "b_middle.png": 20, "a_newest.png": 0}[name])
    navigation = "frame,timestamp_utc,latitude,longitude,heading_deg,ping_start,ping_end\n" + "".join(
        f"{name},2026-09-01T15:30:{index:02d}Z,18.92184,72.83466,128.4,{120000 + index * 800},{120799 + index * 800}\n"
        for index, name in enumerate(names)
    )
    mission = {"sequence_mode": "SEQUENTIAL_PING", "sequential_ping_evidence": True, "navigation_provenance": "MEASURED"}
    survey = _upload(client, {name: _png(pixels) for name, pixels in _SUBPIPE_LIKE.items()}, mission, navigation)
    (verified,) = survey["surveys"]
    assert verified["membership_provenance"] == "VERIFIED"
    assert verified["navigation_provenance"] == "MEASURED"                          # declared, carried
    assert verified["ping_relationship"]["provenance"] == "DERIVED_FROM_SOURCE"     # derived, separate
    # Since A7 the verified relationship places every Frame on the Survey ping axis; the declared
    # MEASURED bounds do not. The fixed box (rows 4-12) is different pings in each Frame on that axis,
    # so there is still no association, Look or persistence.
    assert all(finding["ping_relationship_provenance"] == "DERIVED_FROM_SOURCE" for finding in survey["findings"])
    assert len(survey["contacts"]) == 3
    assert all(contact["look_count"] == 1 and contact["persistence_evidence_type"] == "SINGLE_OBSERVATION"
               for contact in survey["contacts"])


def test_upload_of_unrelated_frames_keeps_singleton_surveys(client):
    rasters = {f"sonar_{index}.png": _png(_waterfall(H, seed=index)) for index in range(3)}
    survey = _upload(client, rasters)
    assert [item["membership_provenance"] for item in survey["surveys"]] == ["SINGLETON"] * 3
    assert all("ping_relationship" not in item for item in survey["surveys"])


def test_zip_member_order_does_not_change_verified_membership(client):
    results = []
    for order in (["a_newest.png", "b_middle.png", "c_oldest.png"], ["c_oldest.png", "a_newest.png", "b_middle.png"]):
        survey = _upload(client, {name: _png(_SUBPIPE_LIKE[name]) for name in order})
        frames = _by_name(survey)
        (verified,) = survey["surveys"]
        name_of = {frame["frame_id"]: name for name, frame in frames.items()}
        results.append({name_of[frame_id]: offset for frame_id, offset in verified["ping_relationship"]["ping_offsets"].items()})
    assert results[0] == results[1] == {"a_newest.png": 0, "b_middle.png": 20, "c_oldest.png": 40}


def test_duplicate_rasters_never_join_a_verified_survey(client):
    """B2 duplicates stay as B2 left them; only the distinct shifted Frames are verified."""
    rasters = {name: _png(pixels) for name, pixels in _SUBPIPE_LIKE.items()}
    rasters["d_copy_of_oldest.png"] = rasters["c_oldest.png"]
    survey = _upload(client, rasters)
    frames = _by_name(survey)
    assert frames["c_oldest.png"]["raster_duplicate_status"] == frames["d_copy_of_oldest.png"]["raster_duplicate_status"] == "DUPLICATE_RASTER"
    for name in ("c_oldest.png", "d_copy_of_oldest.png"):
        assert _survey_of(survey, frames[name])["membership_provenance"] == "SINGLETON"
    verified = _survey_of(survey, frames["a_newest.png"])
    assert verified["membership_provenance"] == "VERIFIED"
    assert verified["frame_ids"] == [frames["a_newest.png"]["frame_id"], frames["b_middle.png"]["frame_id"]]
