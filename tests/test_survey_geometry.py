"""Round-2 ticket B5: Frames of different raster geometry never share a Survey (spec B rule 4, I-B2).

The geometry signature is B1's (width, height, channel layout). A Survey is one contiguous recording
by one sonar in one pass, so no membership path may join Frames whose signatures differ. Upload order
never establishes membership. The frozen detector is faked and every test uses an isolated runtime
directory.
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
def client(monkeypatch, tmp_path) -> TestClient:
    monkeypatch.setattr(FinalDetector, "infer", _fake_infer)
    monkeypatch.setenv("SAGARDRISHTI_RUNTIME_DIR", str(tmp_path / "runtime"))
    return TestClient(create_app(ROOT))


def _encode(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _textured(size: tuple[int, int], seed: int, mode: str = "RGB") -> bytes:
    width, height = size
    channels = {"RGB": 3, "RGBA": 4}.get(mode)
    shape = (height, width) if channels is None else (height, width, channels)
    return _encode(Image.fromarray(np.random.default_rng(seed).integers(0, 256, shape, dtype=np.uint8), mode=mode))


def _upload(client: TestClient, entries: dict[str, bytes | str]) -> dict:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    response = client.post("/api/v1/surveys/upload", files={"file": ("bundle.zip", buffer.getvalue(), "application/zip")})
    assert response.status_code == 200, response.text
    body = response.json()
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{body['job_id']}").json()
        if job["state"] in {"COMPLETED", "FAILED"}:
            break
        time.sleep(0.02)
    assert job["state"] == "COMPLETED", job
    return client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()


def _assert_every_survey_has_one_geometry(survey: dict, layouts: dict[str, str] | None = None) -> None:
    """I-B1 and I-B2 over the stored record.

    Frames record width and height; channel layout is recorded only on the Survey, so the test
    supplies the layout it built for each file name when layouts differ.
    """
    frames = {frame["frame_id"]: frame for frame in survey["frames"]}
    assert sorted(frame_id for item in survey["surveys"] for frame_id in item["frame_ids"]) == sorted(frames)
    for item in survey["surveys"]:
        members = [frames[frame_id] for frame_id in item["frame_ids"]]
        assert {(frame["width_px"], frame["height_px"]) for frame in members} == {
            (item["geometry_signature"]["width_px"], item["geometry_signature"]["height_px"])}
        if layouts is not None:
            assert {layouts[Path(frame["source_path"]).name] for frame in members} == {item["geometry_signature"]["channel_layout"]}


def test_upload_mixing_a_5000x500_and_a_640x640_raster_yields_two_surveys(client):
    survey = _upload(client, {"subpipe_like.png": _textured((5000, 500), 1), "ai4_like.png": _textured((640, 640), 2)})
    assert len(survey["surveys"]) >= 2
    assert sorted((item["geometry_signature"]["width_px"], item["geometry_signature"]["height_px"]) for item in survey["surveys"]) == [
        (640, 640), (5000, 500),
    ]
    _assert_every_survey_has_one_geometry(survey)


def test_v4_style_seven_frame_multi_source_bundle_is_seven_singleton_surveys(client):
    """Seven Frames from three sources, a declared sequential contract and synthetic demo navigation (as v4)."""
    rasters = {
        "v4_01_sss_a.png": _textured((640, 640), 11), "v4_02_sss_b.png": _textured((640, 640), 12),
        "v4_03_sss_c.png": _textured((640, 640), 13), "v4_04_pipe_a.png": _textured((500, 250), 14),
        "v4_05_pipe_b.png": _textured((500, 250), 15), "v4_06_wreck_a.png": _textured((432, 216), 16, "L"),
        "v4_07_wreck_b.png": _textured((432, 216), 17, "L"),
    }
    navigation = "frame,timestamp_utc,latitude,longitude,heading_deg,ping_start,ping_end\n" + "".join(
        f"{name},2026-09-01T15:30:{index:02d}Z,15.5,83.1,128.4,{120000 + index * 800},{120799 + index * 800}\n"
        for index, name in enumerate(sorted(rasters))
    )
    survey = _upload(client, {
        **rasters, "navigation.csv": navigation,
        "mission.json": json.dumps({"sequence_mode": "SEQUENTIAL_PING", "sequential_ping_evidence": True}),
        "provenance.json": json.dumps({"navigation_source": "SYNTHETIC_DEMO_NAVIGATION", "navigation_is_synthetic": True}),
    })
    assert [item["membership_provenance"] for item in survey["surveys"]] == ["SINGLETON"] * 7
    assert all(len(item["frame_ids"]) == 1 for item in survey["surveys"])
    _assert_every_survey_has_one_geometry(survey)
    # Upload order and the declared sequence establish nothing: no multi-Look Contact, no persistence.
    assert all(contact["look_count"] == 1 and contact["persistence_evidence_type"] == "SINGLE_OBSERVATION"
               for contact in survey["contacts"])


def test_row_shift_identity_across_different_channel_layouts_never_shares_a_survey(client):
    """A palette Frame and an RGBA Frame can hold identical expanded pixels; their layouts still differ."""
    rng = np.random.default_rng(5)
    height, width, k = 80, 40, 10
    waterfall_index = rng.integers(0, 256, (height + k, width), dtype=np.uint8)
    palette = list(rng.integers(0, 256, 768, dtype=np.uint8))

    def palette_frame(start: int) -> Image.Image:
        image = Image.fromarray(waterfall_index[start:start + height], mode="P")
        image.putpalette(palette)
        return image

    later_palette, earlier_palette = palette_frame(0), palette_frame(k)
    earlier_rgba = earlier_palette.convert("RGBA")
    # Control: the palette pair alone is a genuine row-shift pair and forms one VERIFIED Survey.
    control = _upload(client, {"later.png": _encode(later_palette), "earlier.png": _encode(earlier_palette)})
    assert [item["membership_provenance"] for item in control["surveys"]] == ["VERIFIED"]

    mixed = _upload(client, {"later.png": _encode(later_palette), "earlier.png": _encode(earlier_rgba)})
    assert [item["membership_provenance"] for item in mixed["surveys"]] == ["SINGLETON", "SINGLETON"]
    _assert_every_survey_has_one_geometry(mixed, {"later.png": "P", "earlier.png": "RGBA"})


def test_upload_order_never_changes_geometry_partitioning(client):
    rasters = {"a.png": _textured((64, 48), 1), "b.png": _textured((48, 64), 2), "c.png": _textured((64, 48), 3, "L")}
    layouts = {"a.png": "RGB", "b.png": "RGB", "c.png": "L"}
    partitions = []
    for order in (["a.png", "b.png", "c.png"], ["c.png", "b.png", "a.png"]):
        survey = _upload(client, {name: rasters[name] for name in order})
        by_frame = {frame["frame_id"]: Path(frame["source_path"]).name for frame in survey["frames"]}
        partitions.append(sorted((tuple(sorted(by_frame[f] for f in item["frame_ids"])), item["membership_provenance"],
                                  json.dumps(item["geometry_signature"], sort_keys=True)) for item in survey["surveys"]))
        _assert_every_survey_has_one_geometry(survey, layouts)
    assert partitions[0] == partitions[1]
    assert len(partitions[0]) == 3


# ------------------------------------------------ DECLARED membership (PID-22 / B5)
#
# mission.json may declare Survey groups: ``declared_surveys`` is a list of groups, each a list of the
# raster file names in the Upload. A declaration groups Frames only; it never establishes sequence,
# adjacency, navigation validity, Looks or persistence, and a group spanning geometries is rejected.

def _post(client: TestClient, entries: dict[str, bytes | str]):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return client.post("/api/v1/surveys/upload", files={"file": ("bundle.zip", buffer.getvalue(), "application/zip")})


def _mission(**fields) -> str:
    return json.dumps(fields)


def _members(survey: dict) -> list[tuple[str, tuple[str, ...]]]:
    names = {frame["frame_id"]: Path(frame["source_path"]).name for frame in survey["frames"]}
    return sorted((item["membership_provenance"], tuple(sorted(names[f] for f in item["frame_ids"]))) for item in survey["surveys"])


_SAME_GEOMETRY = {"a.png": _textured((64, 48), 21), "b.png": _textured((64, 48), 22), "c.png": _textured((64, 48), 23)}


def test_declared_group_with_common_geometry_forms_one_declared_survey(client):
    survey = _upload(client, {**_SAME_GEOMETRY, "mission.json": _mission(declared_surveys=[["b.png", "a.png"]])})
    assert _members(survey) == [("DECLARED", ("a.png", "b.png")), ("SINGLETON", ("c.png",))]
    frames = {Path(frame["source_path"]).name: frame for frame in survey["frames"]}
    (declared,) = [item for item in survey["surveys"] if item["membership_provenance"] == "DECLARED"]
    assert frames["a.png"]["survey_ref"] == frames["b.png"]["survey_ref"] == declared["survey_ref"]
    assert declared["geometry_signature"] == {"width_px": 64, "height_px": 48, "channel_layout": "RGB"}
    assert "ping_relationship" not in declared
    # Every Frame persists its own geometry signature, so membership can be checked per Frame.
    assert all(frame["geometry_signature"] == {"width_px": 64, "height_px": 48, "channel_layout": "RGB"} for frame in frames.values())
    _assert_every_survey_has_one_geometry(survey, {"a.png": "RGB", "b.png": "RGB", "c.png": "RGB"})


@pytest.mark.parametrize("other", [
    _textured((48, 64), 30),         # different width and height
    _textured((64, 48), 31, "L"),    # same size, different channel layout
], ids=["size", "channel_layout"])
def test_declared_group_spanning_two_geometries_is_rejected_not_split(client, other):
    response = _post(client, {"a.png": _SAME_GEOMETRY["a.png"], "odd.png": other,
                              "mission.json": _mission(declared_surveys=[["a.png", "odd.png"]])})
    assert response.status_code == 422
    assert response.json()["error"]["detail"]["field"] == "declared_surveys"
    assert client.get("/api/v1/runtime/surveys").json()["total"] == 0  # nothing was accepted or processed


@pytest.mark.parametrize("declared", [
    "a.png",                          # not a list of groups
    [["a.png"], "b.png"],             # a group that is not a list
    [[]],                             # an empty group
    [["a.png", 7]],                   # a member that is not a file name
    [["a.png", ""]],                  # an empty member
    [["a.png", "missing.png"]],       # a member not in this Upload
    [["frame_0000", "frame_0001"]],   # generated Frame ids are not stable source identifiers
    [["a.png", "a.png"]],             # a member repeated in one group
    [["a.png", "b.png"], ["b.png"]],  # a Frame declared in two Surveys (I-B1)
], ids=["not_list", "group_not_list", "empty_group", "non_string", "empty_name", "unknown", "frame_ids", "repeated", "two_groups"])
def test_malformed_declarations_are_rejected(client, declared):
    response = _post(client, {**_SAME_GEOMETRY, "mission.json": _mission(declared_surveys=declared)})
    assert response.status_code == 422, response.text
    assert response.json()["error"]["detail"]["field"] == "declared_surveys"


def test_declared_membership_does_not_depend_on_upload_or_declaration_order(client):
    results = []
    for zip_order, declared in (
        (["a.png", "b.png", "c.png"], [["a.png", "b.png"], ["c.png"]]),
        (["c.png", "b.png", "a.png"], [["c.png"], ["b.png", "a.png"]]),
    ):
        survey = _upload(client, {**{name: _SAME_GEOMETRY[name] for name in zip_order}, "mission.json": _mission(declared_surveys=declared)})
        results.append((_members(survey), sorted((item["survey_ref"].split(".", 1)[1], tuple(item["frame_ids"])) for item in survey["surveys"])))
    assert results[0] == results[1]
    assert results[0][0] == [("DECLARED", ("a.png", "b.png")), ("DECLARED", ("c.png",))]


def test_declared_membership_establishes_no_sequence_looks_or_persistence(client):
    names = sorted(_SAME_GEOMETRY)
    navigation = "frame,timestamp_utc,latitude,longitude,heading_deg,ping_start,ping_end\n" + "".join(
        f"{name},2026-09-01T15:30:{index:02d}Z,18.92184,72.83466,128.4,{120000 + index * 800},{120799 + index * 800}\n"
        for index, name in enumerate(names)
    )
    survey = _upload(client, {**_SAME_GEOMETRY, "navigation.csv": navigation, "mission.json": _mission(
        declared_surveys=[names], sequence_mode="SEQUENTIAL_PING", sequential_ping_evidence=True, navigation_provenance="MEASURED",
    )})
    (declared,) = survey["surveys"]
    assert declared["membership_provenance"] == "DECLARED"
    assert declared["navigation_provenance"] == "MEASURED"  # carried, unchanged in meaning
    assert "ping_relationship" not in declared
    assert all(finding["sequential_observation_supported"] is False for finding in survey["findings"])
    assert len(survey["contacts"]) == 3
    assert all(contact["look_count"] == 1 and contact["association_basis"] == "SINGLE"
               and contact["persistence_evidence_type"] == "SINGLE_OBSERVATION" for contact in survey["contacts"])


def _row_shifted(count: int, k: int = 10, seed: int = 40) -> dict[str, bytes]:
    """``count`` RGB Frames of one waterfall, each k rows after the next (``s0`` newest)."""
    height, width = 60, 40
    waterfall = np.random.default_rng(seed).integers(0, 256, (height + k * (count - 1), width, 3), dtype=np.uint8)
    return {f"s{index}.png": _encode(Image.fromarray(waterfall[index * k:index * k + height])) for index in range(count)}


def test_undeclared_frames_are_never_absorbed_into_a_declared_survey(client):
    """s2 shares pings with the declared s0/s1 and has their geometry, yet stays outside their Survey."""
    survey = _upload(client, {**_row_shifted(3), "mission.json": _mission(declared_surveys=[["s0.png", "s1.png"]])})
    assert _members(survey) == [("DECLARED", ("s0.png", "s1.png")), ("SINGLETON", ("s2.png",))]


def test_declaration_takes_precedence_over_verification_and_undeclared_frames_still_verify(client):
    """Rule 3 order: declared Frames are DECLARED (never also VERIFIED); B4 still verifies the others."""
    survey = _upload(client, {**_row_shifted(4), "mission.json": _mission(declared_surveys=[["s0.png", "s1.png"]])})
    assert _members(survey) == [("DECLARED", ("s0.png", "s1.png")), ("VERIFIED", ("s2.png", "s3.png"))]
    (verified,) = [item for item in survey["surveys"] if item["membership_provenance"] == "VERIFIED"]
    assert verified["ping_relationship"]["provenance"] == "DERIVED_FROM_SOURCE"
    assert sorted(verified["ping_relationship"]["ping_offsets"].values()) == [0, 10]
