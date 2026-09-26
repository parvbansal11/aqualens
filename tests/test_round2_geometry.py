"""Round-2 ticket H0-6: geometry records under PID-02 (spec H0 item 2, §6 geometry record, H0-AC5).

PID-02: nadir x_i is the argmax of the image column mean within ±5 % of the centre column (integer columns x with
|x − W/2| ≤ 0.05·W; native single-channel values; a tied maximum resolves to the midpoint of the first and last
tied columns). Water-column half-width and nadir confidence stay UNAVAILABLE: no validated water-column edge
procedure exists, so they are never estimated, guessed or set to 0. PING's range axis is UNKNOWN (spec H0 item 2).
"""
from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from round2.geometry import (
    NADIR_METHOD, RANGE_AXIS, GeometryError, estimate_nadir, geometry_record, nadir_window, write_geometry,
)
from round2.guards import reference_view


def _save(root: Path, name: str, pixels: np.ndarray, mode: str = "L") -> Path:
    path = root / name
    Image.fromarray(pixels, mode=mode).save(path)
    return path


def _row(path: Path, dataset: str = "SUBPIPE", split: str = "val", **extra) -> dict:
    with Image.open(path) as image:
        width, height = image.size
    return {"image_id": path.stem, "dataset": dataset, "sensor": {"SUBPIPE": "Klein 3500", "AI4SHIPWRECKS": "EdgeTech 2205",
                                                                   "PING_GHOSTVISION": "Humminbird"}[dataset],
            "channel": "HF" if dataset == "SUBPIPE" else None, "split": split, "survey_id": f"S:{path.stem}",
            "bootstrap_group": f"G:{path.stem}", "augmentation_parent": None, "source_path": path.name,
            "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "image_width": width, "image_height": height,
            "gt_boxes": [{"class": "PIPELINE", "xyxy_px": [1.0, 1.0, 5.0, 5.0]}], "gt_object_regions": None,
            "gt_object_regions_status": "NOT_APPLICABLE", "gt_boxes_derivation": "BBOX", **extra}


def _waterfall(width: int, height: int = 40, seed: int = 0) -> np.ndarray:
    return np.random.default_rng(seed).integers(20, 120, (height, width), dtype=np.uint8)


# --- the ±5 % window

@pytest.mark.parametrize("width, expected", [(5000, (2250, 2750)), (2500, (1125, 1375)), (1728, (778, 950)), (640, (288, 352))])
def test_the_window_is_the_integer_columns_within_5_percent_of_w_over_2(width, expected):
    assert nadir_window(width) == expected


# --- nadir estimation

def test_a_known_nadir_is_recovered_exactly():
    pixels = _waterfall(5000)
    pixels[:, 2493] = 250
    nadir = estimate_nadir(pixels)
    assert nadir["nadir_col"] == 2493.0 and nadir["tie_interval"] == [2493, 2493] and nadir["tied_columns"] == 1


def test_a_tied_plateau_resolves_to_its_midpoint():
    pixels = _waterfall(5000)
    pixels[:, 2490:2500] = 255                       # a saturated 10-column nadir return, as on SubPipe
    nadir = estimate_nadir(pixels)
    assert nadir["nadir_col"] == 2494.5 and nadir["tie_interval"] == [2490, 2499] and nadir["tied_columns"] == 10


def test_non_contiguous_ties_use_the_first_and_last_tied_columns():
    pixels = _waterfall(2500)
    pixels[:, [1200, 1210, 1300]] = 255
    nadir = estimate_nadir(pixels)
    assert nadir["nadir_col"] == 1250.0 and nadir["tie_interval"] == [1200, 1300] and nadir["tied_columns"] == 3


def test_a_brighter_column_outside_the_window_is_ignored():
    pixels = _waterfall(5000)
    pixels[:, 100] = 255
    pixels[:, 2600] = 200
    assert estimate_nadir(pixels)["nadir_col"] == 2600.0


def test_nadir_always_lies_inside_the_window():
    for seed in range(25):
        width = random.Random(seed).choice([640, 1728, 2500, 5000])
        nadir = estimate_nadir(_waterfall(width, seed=seed))
        lo, hi = nadir_window(width)
        assert lo <= nadir["nadir_col"] <= hi and nadir["search_window"] == [lo, hi]


def test_identical_pixels_give_identical_nadir():
    pixels = _waterfall(2500, seed=3)
    assert estimate_nadir(pixels) == estimate_nadir(pixels.copy())


# --- records: unavailable stays unavailable

def test_water_column_and_nadir_confidence_are_unavailable_even_with_an_obvious_water_column(tmp_path):
    pixels = _waterfall(5000)
    pixels[:, 2300:2700] = 0                           # a clear dark water column
    pixels[:, 2495:2505] = 255                         # and a nadir return
    record = geometry_record(_row(_save(tmp_path, "wc.png", pixels)), tmp_path)
    assert record["range_axis"] == "COLUMNS" and record["nadir_col"] == 2499.5 and record["nadir_status"] == "ESTIMATED"
    assert record["water_column_halfwidth_px"] is None and record["water_column_halfwidth_status"] == "UNAVAILABLE_PID_02"
    assert record["nadir_confidence"] is None and record["nadir_confidence_status"] == "UNAVAILABLE_PID_02"


def test_ping_records_have_an_unknown_range_axis_and_no_nadir(tmp_path):
    path = _save(tmp_path, "ping.png", np.random.default_rng(1).integers(0, 256, (64, 64, 3), dtype=np.uint8), mode="RGB")
    record = geometry_record(_row(path, dataset="PING_GHOSTVISION"), tmp_path)
    assert RANGE_AXIS == {"SUBPIPE": "COLUMNS", "AI4SHIPWRECKS": "COLUMNS", "PING_GHOSTVISION": "UNKNOWN"}
    assert record["range_axis"] == "UNKNOWN" and record["nadir_col"] is None
    assert record["nadir_status"] == "NOT_APPLICABLE_RANGE_AXIS_UNKNOWN"
    assert record["water_column_halfwidth_px"] is None and record["nadir_confidence"] is None


@pytest.mark.parametrize("dataset, channel", [("SUBPIPE", "HF"), ("SUBPIPE", "LF"), ("AI4SHIPWRECKS", None)])
def test_representative_range_axis_datasets_use_the_same_rule(tmp_path, dataset, channel):
    pixels = _waterfall(1728)
    pixels[:, 870] = 240
    record = geometry_record(_row(_save(tmp_path, f"{dataset}{channel}.png", pixels), dataset=dataset, channel=channel), tmp_path)
    assert record["nadir_col"] == 870.0 and record["nadir_method"] == NADIR_METHOD
    assert record["channel"] == channel and record["dataset"] == dataset


def test_file_names_labels_and_detections_never_change_the_record(tmp_path):
    pixels = _waterfall(2500, seed=5)
    one, two = _save(tmp_path, "one.png", pixels), _save(tmp_path, "renamed_copy.png", pixels)
    base = geometry_record(_row(one), tmp_path)
    renamed = geometry_record(_row(two), tmp_path)
    relabelled = geometry_record(_row(one, gt_boxes=[{"class": "SHIPWRECK", "xyxy_px": [0, 0, 999, 99]}],
                                      detections=[{"raw_class": "PIPELINE", "bbox_px": [1200, 0, 1300, 40]}]), tmp_path)
    gt_free = geometry_record(reference_view([_row(one)])[0], tmp_path)
    keys = ("nadir_col", "tie_interval", "tied_columns", "search_window", "range_axis")
    assert {k: base[k] for k in keys} == {k: renamed[k] for k in keys} == {k: relabelled[k] for k in keys} == {k: gt_free[k] for k in keys}
    assert not any(key.startswith("gt_") or "detection" in key for key in relabelled)


def test_a_source_that_does_not_match_its_manifest_sha256_is_refused(tmp_path):
    path = _save(tmp_path, "x.png", _waterfall(640))
    with pytest.raises(GeometryError, match="SHA-256"):
        geometry_record(_row(path, source_sha256="0" * 64), tmp_path)


def test_a_range_axis_image_that_is_not_single_channel_is_refused_not_converted(tmp_path):
    path = _save(tmp_path, "rgb.png", np.zeros((40, 640, 3), dtype=np.uint8), mode="RGB")
    with pytest.raises(GeometryError, match="single-channel"):
        geometry_record(_row(path), tmp_path)


# --- the artifact

def _corpus(tmp_path: Path) -> tuple[Path, list[dict]]:
    root = tmp_path / "corpus"
    root.mkdir()
    rows = []
    for index, (dataset, split) in enumerate([("SUBPIPE", "train"), ("SUBPIPE", "test"), ("AI4SHIPWRECKS", "val"), ("PING_GHOSTVISION", "test")]):
        if dataset == "PING_GHOSTVISION":
            path = _save(root, f"img{index}.png", np.zeros((64, 64, 3), dtype=np.uint8), mode="RGB")
        else:
            pixels = _waterfall(1728, seed=index)
            pixels[:, 860:864] = 255
            path = _save(root, f"img{index}.png", pixels)
        rows.append(_row(path, dataset=dataset, split=split))
    return root, rows


def test_every_image_gets_a_record_and_the_report_is_written(tmp_path):
    root, rows = _corpus(tmp_path)
    out = tmp_path / "geometry" / "iter-1"
    provenance = write_geometry(out, root, manifest_rows=rows, manifest_sha256="f" * 64)
    records = [json.loads(line) for line in (out / "geometry.jsonl").read_text().splitlines()]
    assert sorted(r["image_id"] for r in records) == ["img0", "img1", "img2", "img3"]      # every split, every image
    assert provenance["records"] == 4 and provenance["frozen_manifest_sha256"] == "f" * 64
    report = json.loads((out / "nadir_report.json").read_text())
    assert report["SUBPIPE|HF"]["within_window"] == 2 == report["SUBPIPE|HF"]["images"]
    assert report["AI4SHIPWRECKS|"]["images"] == 1 and "PING_GHOSTVISION|" not in report
    for record in records:
        assert not any(key.startswith("gt_") for key in record)
        assert record["water_column_halfwidth_px"] is None and record["nadir_confidence"] is None


def test_the_artifact_is_deterministic_order_invariant_and_immutable(tmp_path):
    root, rows = _corpus(tmp_path)
    first, second = tmp_path / "a" / "iter-1", tmp_path / "b" / "iter-1"
    write_geometry(first, root, manifest_rows=rows, manifest_sha256="f" * 64)
    write_geometry(second, root, manifest_rows=list(reversed(rows)), manifest_sha256="f" * 64)
    for name in ("geometry.jsonl", "nadir_report.json"):
        assert (first / name).read_bytes() == (second / name).read_bytes()
    with pytest.raises(GeometryError, match="immutable"):
        write_geometry(first, root, manifest_rows=rows, manifest_sha256="f" * 64)
