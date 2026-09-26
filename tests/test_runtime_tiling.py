"""Runtime tiled-inference path for wide/large sonar rasters (FinalDetector.infer).

The frozen final_v1 detector is never modified here; these tests fake
``model.predict`` so they can assert on tiling/remap/dedup behavior without
depending on what the real weights happen to detect.
"""
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from sagar.perception.runtime import FinalDetector, TILE_OVERLAP, TILE_SIZE, needs_tiling

WEIGHTS = Path("ml/artifacts/final_v1/detector/best.pt")
MARKER_VALUE = 200


class _Value:
    def __init__(self, value):
        self._value = value

    def item(self):
        return self._value

    def tolist(self):
        return self._value


class _Box:
    def __init__(self, cls_id, conf, xyxy):
        self.cls = _Value(cls_id)
        self.conf = _Value(conf)
        self.xyxy = [_Value(list(xyxy))]


def _locate_marker(crop: np.ndarray) -> tuple[float, float, float, float] | None:
    ys, xs = np.where(crop[:, :, 0] == MARKER_VALUE)
    if len(xs) == 0:
        return None
    return (float(xs.min()), float(ys.min()), float(xs.max() + 1), float(ys.max() + 1))


def _marker_detector(class_id: int = 1, confidence: float = 0.37) -> FinalDetector:
    """A detector whose fake model reports one box wherever the marker pixels land
    in whatever crop it is given -- tile-local or full-frame alike."""
    detector = FinalDetector(WEIGHTS)
    detector.load = lambda: None  # type: ignore[method-assign]

    def predict(**kwargs):
        crop = kwargs["source"]
        located = _locate_marker(crop)
        boxes = [_Box(class_id, confidence, located)] if located is not None else []
        return [SimpleNamespace(boxes=boxes)]

    detector.model = SimpleNamespace(predict=predict)
    return detector


def _save(array: np.ndarray, tmp_path: Path) -> Path:
    path = tmp_path / "frame.png"
    Image.fromarray(array).save(path)
    return path


def test_wide_frame_triggers_tiled_mode(tmp_path):
    width, height = 1800, 800
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    assert needs_tiling(width, height)
    detector = _marker_detector()
    meta, findings = detector.infer(_save(frame, tmp_path), "survey_wide", "frame_0000")
    assert meta["inference_mode"] == "TILED"
    assert meta["tile_count"] > 1
    assert all(f["inference_mode"] == "TILED" for f in findings)
    assert all(f["tile_size"] == TILE_SIZE and f["tile_overlap"] == TILE_OVERLAP for f in findings)


def test_narrow_small_frame_preserves_full_frame_mode(tmp_path):
    width, height = 640, 480
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    frame[200:220, 300:320] = MARKER_VALUE
    assert not needs_tiling(width, height)
    detector = _marker_detector()
    meta, findings = detector.infer(_save(frame, tmp_path), "survey_narrow", "frame_0000")
    assert meta["inference_mode"] == "FULL_FRAME"
    assert meta["tile_count"] == 0
    assert len(findings) == 1
    assert findings[0]["inference_mode"] == "FULL_FRAME"
    assert findings[0]["tile_size"] is None
    assert findings[0]["tile_overlap"] is None
    assert findings[0]["tile_id"] is None


def test_right_edge_detection_maps_into_original_coordinates(tmp_path):
    width, height = 1800, 800
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    # Placed close to the right edge of a wide raster -- exactly the region a
    # naive single-pass (imgsz=640) full-frame inference would blur past.
    x1, y1, x2, y2 = 1760, 380, 1780, 400
    frame[y1:y2, x1:x2] = MARKER_VALUE
    detector = _marker_detector()
    _, findings = detector.infer(_save(frame, tmp_path), "survey_edge", "frame_0000")
    assert len(findings) == 1
    bx1, by1, bx2, by2 = findings[0]["bbox_px"]
    assert bx1 == pytest.approx(x1, abs=1) and by1 == pytest.approx(y1, abs=1)
    assert bx2 == pytest.approx(x2, abs=1) and by2 == pytest.approx(y2, abs=1)
    assert bx2 <= width and by2 <= height


def test_duplicate_overlapping_tile_boxes_collapse_via_nms(tmp_path):
    width, height = 1800, 800
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    # This marker sits in the 30% overlap band shared by two adjacent x-tiles,
    # so the fake detector reports it twice before dedup.
    frame[380:400, 1760:1780] = MARKER_VALUE
    detector = _marker_detector(confidence=0.6)
    meta, findings = detector.infer(_save(frame, tmp_path), "survey_dup", "frame_0000")
    assert meta["tile_count"] >= 2
    assert len(findings) == 1
    assert findings[0]["raw_confidence"] == pytest.approx(0.6)


def test_normalized_bboxes_stay_within_unit_range(tmp_path):
    width, height = 1800, 800
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    frame[10:30, 1795:1799] = MARKER_VALUE  # hugs the true right edge
    detector = _marker_detector()
    _, findings = detector.infer(_save(frame, tmp_path), "survey_norm", "frame_0000")
    assert findings
    for finding in findings:
        for value in finding["bbox_normalized"]:
            assert 0.0 <= value <= 1.0


def test_detection_ids_remain_unique_across_tiles(tmp_path):
    width, height = 1800, 800
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    # Two well-separated markers land in different tiles, each producing its
    # own surviving detection after dedup.
    frame[50:70, 50:70] = MARKER_VALUE
    frame[600:620, 1700:1720] = MARKER_VALUE
    detector = _marker_detector()
    _, findings = detector.infer(_save(frame, tmp_path), "survey_ids", "frame_0000")
    ids = [f["detection_id"] for f in findings]
    assert len(ids) == len(set(ids))
    assert len(ids) >= 2


def test_raw_confidence_survives_unchanged_through_tiling(tmp_path):
    width, height = 1800, 800
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    frame[380:400, 1760:1780] = MARKER_VALUE
    detector = _marker_detector(confidence=0.1289173)
    _, findings = detector.infer(_save(frame, tmp_path), "survey_raw_conf", "frame_0000")
    assert len(findings) == 1
    assert findings[0]["raw_confidence"] == 0.1289173
