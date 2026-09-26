"""Round-2 ticket H0-5: layer-16 cells from the harness's own forward pass (spec C item 1, H0 item 4).

The tap hooks layer 16 of the frozen detector during H0-4's production-path inference, so it adds no network
pass. Each tile (768) or frame (640) gives a 20 × 20 grid of 128-d cells, average-pooled from the 80 × 80 map and
L2-normalised, kept in float32. Cells equal an independent extraction of the same input. The cache covers every
val and test image of the frozen manifest and records the detector SHA. Fakes follow the runtime tests; one test
uses the real frozen weights on synthetic images only.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import torch
from PIL import Image

from round2.features import CELL_GRID, LAYER_INDEX, cell_valid_fraction, pool_cells, tapped_infer_row, write_cache
from round2.infer import ScientificPathError, infer_row, scientific_detector
from sagar.perception.runtime import TILE_SIZE, FinalDetector

WEIGHTS = Path("ml/artifacts/final_v1/detector/best.pt")


class _Layer16(torch.nn.Module):
    """A deterministic stand-in for layer 16: a (1, 128, 80, 80) map derived from the input pixels."""

    def __init__(self):
        super().__init__()
        self.forwards = 0

    def forward(self, x):
        self.forwards += 1
        pooled = torch.nn.functional.adaptive_avg_pool2d(x, (80, 80))                     # (1, 3, 80, 80)
        scales = torch.arange(1, 129, dtype=torch.float32).view(1, 128, 1, 1)
        return pooled.repeat(1, 43, 1, 1)[:, :128] * scales + scales / 100.0


class _FakeYOLO:
    """predict() runs the layer once per call, twice on the first call (as Ultralytics' warm-up does)."""

    def __init__(self):
        self.layer = _Layer16()
        self.model = SimpleNamespace(model=[torch.nn.Identity() for _ in range(LAYER_INDEX)] + [self.layer])
        self.predict_calls = 0
        self._warm = False

    @staticmethod
    def as_input(source: np.ndarray) -> torch.Tensor:
        return torch.from_numpy(np.ascontiguousarray(source)).permute(2, 0, 1).unsqueeze(0).float() / 255.0

    def predict(self, **kwargs):
        self.predict_calls += 1
        if not self._warm:
            self.layer(torch.zeros(1, 3, 640, 640))       # warm-up forward
            self._warm = True
        self.layer(self.as_input(kwargs["source"]))
        return [SimpleNamespace(boxes=[])]


def _faked(detector: FinalDetector) -> FinalDetector:
    detector.load = lambda: None  # type: ignore[method-assign]
    detector.model = _FakeYOLO()
    return detector


def _image(tmp_path: Path, name: str, size: tuple[int, int], seed: int = 0) -> Path:
    width, height = size
    path = tmp_path / name
    Image.fromarray(np.random.default_rng(seed).integers(0, 256, (height, width, 3), dtype=np.uint8)).save(path)
    return path


def _row(path: Path, split: str = "val", **extra) -> dict:
    with Image.open(path) as image:
        width, height = image.size
    return {"image_id": path.stem, "dataset": "SUBPIPE", "sensor": "Klein 3500", "channel": "HF", "split": split,
            "survey_id": f"S:{path.stem}", "bootstrap_group": f"S:{path.stem}:block0", "augmentation_parent": None,
            "source_path": path.name, "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "image_width": width, "image_height": height, "gt_boxes": [], "gt_object_regions": None,
            "gt_object_regions_status": "NOT_APPLICABLE", "gt_boxes_derivation": "BBOX", **extra}


TILED, FULL = (1800, 800), (640, 640)   # 4 × 2 tiles; one full frame


# --- the tap adds no pass and changes no detection

@pytest.mark.parametrize("size", [TILED, FULL], ids=["tiled", "full_frame"])
def test_forward_passes_are_equal_with_and_without_the_tap(tmp_path, size):
    path = _image(tmp_path, "f.png", size)
    plain, tapped = _faked(scientific_detector()), _faked(scientific_detector())
    plain_result = infer_row(plain, _row(path), tmp_path)
    tapped_result, _ = tapped_infer_row(tapped, _row(path), tmp_path)
    assert tapped.model.predict_calls == plain.model.predict_calls
    assert tapped.model.layer.forwards == plain.model.layer.forwards
    assert {k: v for k, v in tapped_result.items() if k != "grids"} == plain_result


# --- cells: 20 × 20 per 768 tile or 640 frame, 128-d, L2-normalised, float32

@pytest.mark.parametrize("size, grids", [(TILED, 8), (FULL, 1)], ids=["tiled", "full_frame"])
def test_cells_are_20_by_20_per_tile_or_frame_and_l2_normalised(tmp_path, size, grids):
    path = _image(tmp_path, "f.png", size)
    result, cells = tapped_infer_row(_faked(scientific_detector()), _row(path), tmp_path)
    assert CELL_GRID == 20 and LAYER_INDEX == 16
    assert cells.shape == (grids, 20, 20, 128) and cells.dtype == np.float32
    np.testing.assert_allclose(np.linalg.norm(cells, axis=-1), 1.0, rtol=0, atol=1e-5)
    assert len(result["grids"]) == grids == (result["tile_count"] or 1)


def test_pooling_is_the_exact_4_by_4_block_mean_then_l2():
    feature = torch.arange(128 * 80 * 80, dtype=torch.float32).reshape(1, 128, 80, 80)
    cells = pool_cells(feature)
    block = feature[0, :, 4:8, 8:12].mean(dim=(1, 2)).numpy()
    np.testing.assert_allclose(cells[1, 2], block / np.linalg.norm(block), rtol=1e-6)
    with pytest.raises(ScientificPathError, match="80"):
        pool_cells(torch.zeros(1, 128, 80, 60))


def test_cached_cells_equal_an_independent_extraction(tmp_path):
    path = _image(tmp_path, "f.png", TILED)
    result, cells = tapped_infer_row(_faked(scientific_detector()), _row(path), tmp_path)
    independent = _FakeYOLO()
    with Image.open(path) as image:
        prepared = np.asarray(image.convert("RGB"))[:, :, ::-1].copy()     # the runtime's BGR contract
    for index, grid in enumerate(result["grids"]):
        ox, oy = grid["origin_px"]
        crop = prepared[oy:oy + TILE_SIZE, ox:ox + TILE_SIZE]
        crop = np.pad(crop, ((0, TILE_SIZE - crop.shape[0]), (0, TILE_SIZE - crop.shape[1]), (0, 0)))
        expected = pool_cells(independent.layer(independent.as_input(crop)))
        np.testing.assert_allclose(cells[index], expected, rtol=0, atol=1e-6)


def test_the_first_call_warm_up_forward_is_not_taken_as_a_cell_map(tmp_path):
    path = _image(tmp_path, "f.png", FULL)
    detector = _faked(scientific_detector())
    _, cells = tapped_infer_row(detector, _row(path), tmp_path)
    warm = pool_cells(detector.model.layer(torch.zeros(1, 3, 640, 640)))
    assert not np.allclose(cells[0], warm)


# --- tile padding is recorded exactly, never decided

def test_valid_fraction_records_how_much_of_each_cell_is_image():
    # A 768 tile at y = 538 of an 800-row frame holds 262 image rows; cells are 38.4 px.
    fraction = cell_valid_fraction(origin=(1076, 538), native=(TILE_SIZE, TILE_SIZE), image=(1800, 800))
    assert fraction.shape == (20, 20) and fraction.dtype == np.float32
    np.testing.assert_allclose(fraction[:6, 0], 1.0)
    np.testing.assert_allclose(fraction[6, 0], (262 - 6 * 38.4) / 38.4, rtol=1e-6)
    np.testing.assert_allclose(fraction[7:, :], 0.0)
    np.testing.assert_allclose(fraction[:6, 18], (1800 - 1076 - 18 * 38.4) / 38.4, rtol=1e-6)
    np.testing.assert_allclose(cell_valid_fraction(origin=(0, 0), native=(640, 640), image=(640, 640)), 1.0)


# --- scientific path guards still hold through the tap

def test_the_tap_refuses_a_detector_with_recovery_on(tmp_path):
    path = _image(tmp_path, "f.png", FULL)
    with pytest.raises(ScientificPathError, match="recovery"):
        tapped_infer_row(_faked(FinalDetector(WEIGHTS)), _row(path), tmp_path)


# --- the cache: every val and test image, never train; provenance; determinism

def _corpus(tmp_path: Path) -> tuple[Path, list[dict]]:
    root = tmp_path / "corpus"
    root.mkdir()
    rows = [_row(_image(root, f"{name}.png", size, seed), split=split)
            for seed, (name, size, split) in enumerate([("a", TILED, "val"), ("b", FULL, "test"), ("c", FULL, "train"), ("d", FULL, "test")])]
    return root, rows


def test_the_cache_covers_every_val_and_test_image_and_never_train(tmp_path):
    root, rows = _corpus(tmp_path)
    out = tmp_path / "cells" / "iter-1"
    provenance = write_cache(out, root, manifest_rows=rows, detector=_faked(scientific_detector()), manifest_sha256="f" * 64)
    records = [json.loads(line) for line in (out / "records.jsonl").read_text().splitlines()]
    assert sorted(r["image_id"] for r in records) == ["a", "b", "d"]
    assert provenance["coverage"] == {"val": {"manifest": 1, "cached": 1}, "test": {"manifest": 2, "cached": 2}}
    assert provenance["detector_sha256"] == "2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15"
    assert provenance["inference_config"]["shipwreck_recovery"] is False and provenance["recovery_invocations"] == 0
    assert provenance["dtype"] == "float32" and provenance["frozen_manifest_sha256"] == "f" * 64
    for record in records:
        cells = np.load(out / record["cells_file"])
        assert hashlib.sha256((out / record["cells_file"]).read_bytes()).hexdigest() == record["cells_sha256"]
        assert cells.shape[0] == len(record["grids"]) and cells.dtype == np.float32
        assert not any("display" in key for key in record) and not any(key.startswith("gt_") for key in record)
        assert all(set(d) == {"raw_class_id", "raw_class", "raw_confidence", "bbox_px", "tile_id"} for d in record["detections"])


def test_the_cache_is_deterministic_and_never_overwrites_an_iteration(tmp_path):
    root, rows = _corpus(tmp_path)
    first, second = tmp_path / "one" / "iter-1", tmp_path / "two" / "iter-1"
    write_cache(first, root, manifest_rows=rows, detector=_faked(scientific_detector()), manifest_sha256="f" * 64)
    write_cache(second, root, manifest_rows=rows, detector=_faked(scientific_detector()), manifest_sha256="f" * 64)
    assert (first / "records.jsonl").read_bytes() == (second / "records.jsonl").read_bytes()
    with pytest.raises(ScientificPathError, match="immutable"):
        write_cache(first, root, manifest_rows=rows, detector=_faked(scientific_detector()), manifest_sha256="f" * 64)


# --- the real frozen detector (synthetic images only)

def test_real_frozen_detector_cells_equal_an_independent_extraction(tmp_path):
    path = _image(tmp_path, "real.png", TILED, seed=4)
    detector = scientific_detector()
    result, cells = tapped_infer_row(detector, _row(path), tmp_path)
    assert detector.recovery_invocations == 0 and cells.shape == (8, 20, 20, 128)
    with Image.open(path) as image:
        prepared = np.asarray(image.convert("RGB"))[:, :, ::-1].copy()
    ox, oy = result["grids"][5]["origin_px"]
    crop = prepared[oy:oy + TILE_SIZE, ox:ox + TILE_SIZE]
    crop = np.pad(crop, ((0, TILE_SIZE - crop.shape[0]), (0, TILE_SIZE - crop.shape[1]), (0, 0)))
    captured = []
    hook = detector.model.model.model[LAYER_INDEX].register_forward_hook(lambda _m, _i, out: captured.append(out.detach()))
    try:
        detector.model.predict(source=crop, imgsz=640, device=detector.device, verbose=False, conf=0.12)
    finally:
        hook.remove()
    np.testing.assert_allclose(cells[5], pool_cells(captured[-1]), rtol=0, atol=1e-5)
