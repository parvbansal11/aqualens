"""INTERNAL HACKATHON DEMO ONLY: the weak-evidence SHIPWRECK recovery pass in
FinalDetector._recover_weak_shipwreck_cluster / spatial_consensus_presentation.

The frozen final_v1 detector is faked throughout (as in test_runtime_tiling.py)
so these tests exercise the clustering/consolidation/labeling logic
deterministically. A fake predict() distinguishes the two real inference
passes by the `conf` kwarg it's called with: TILE_CONFIDENCE_FLOOR (0.12, the
normal path) vs RECOVERY_CONFIDENCE_FLOOR (0.01, the fallback path) -- exactly
mirroring how the real detector's threshold changes what it returns.
"""
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from sagar.perception.runtime import (
    FinalDetector,
    RECOVERY_CONFIDENCE_FLOOR,
    SHIPWRECK_CLASS_ID,
    TILE_CONFIDENCE_FLOOR,
)

WEIGHTS = Path("ml/artifacts/final_v1/detector/best.pt")
MARKER_VALUE = 200
WIDTH, HEIGHT = 1800, 800  # 4 x-tiles, 2 y-tiles at TILE_SIZE=768 / stride=538


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


def _locate_marker(crop: np.ndarray, marker_value: int) -> tuple[float, float, float, float] | None:
    ys, xs = np.where(crop[:, :, 0] == marker_value)
    if len(xs) == 0:
        return None
    return (float(xs.min()), float(ys.min()), float(xs.max() + 1), float(ys.max() + 1))


def _blank_frame() -> np.ndarray:
    return np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)


def _save(array: np.ndarray, tmp_path: Path) -> Path:
    path = tmp_path / "frame.png"
    Image.fromarray(array).save(path)
    return path


def _detector_from_predict(predict) -> FinalDetector:
    detector = FinalDetector(WEIGHTS, shipwreck_recovery=True)
    detector.load = lambda: None  # type: ignore[method-assign]
    detector.model = SimpleNamespace(predict=predict)
    return detector


def _counting_predict(inner):
    """Wraps a fake predict function with a call counter, keyed by the `conf`
    kwarg it was invoked with, so tests can assert which passes actually ran."""
    calls: dict[float | None, int] = {}

    def predict(**kwargs):
        calls[kwargs.get("conf")] = calls.get(kwargs.get("conf"), 0) + 1
        return inner(**kwargs)

    predict.calls = calls  # type: ignore[attr-defined]
    return predict


def test_isolated_weak_proposal_does_not_surface(tmp_path):
    """A single marker covered by exactly one tile produces exactly one weak
    (0.01-floor) proposal -- below the >=3 support requirement, so no
    recovered finding is created."""
    frame = _blank_frame()
    # Well inside a single tile's non-overlapping region: x-tile 0 is [0,538)
    # exclusive of any neighbour's overlap band, and y-tile 0 covers [0,538).
    frame[100:110, 100:110] = MARKER_VALUE

    def inner(**kwargs):
        crop = kwargs["source"]
        located = _locate_marker(crop, MARKER_VALUE)
        if located is None or kwargs.get("conf") != RECOVERY_CONFIDENCE_FLOOR:
            return [SimpleNamespace(boxes=[])]
        return [SimpleNamespace(boxes=[_Box(SHIPWRECK_CLASS_ID, 0.02, located)])]

    detector = _detector_from_predict(_counting_predict(inner))
    _, findings = detector.infer(_save(frame, tmp_path), "survey_isolated", "frame_0000")
    assert findings == []


def test_coherent_cluster_surfaces_as_one_consolidated_finding(tmp_path):
    """A marker sitting in the x*y overlap band shared by four adjacent tiles
    produces four spatially-agreeing weak proposals -- a coherent cluster that
    must consolidate into exactly one recovered SHIPWRECK finding."""
    frame = _blank_frame()
    # x in [1076,1306) is shared by x-tiles at origin 538 and 1076.
    # y in [538,768) is shared by y-tiles at origin 0 and 538.
    frame[600:620, 1150:1170] = MARKER_VALUE
    weak_confidences = [0.021, 0.033, 0.019, 0.044]
    seen = {"i": 0}

    def inner(**kwargs):
        crop = kwargs["source"]
        located = _locate_marker(crop, MARKER_VALUE)
        if located is None or kwargs.get("conf") != RECOVERY_CONFIDENCE_FLOOR:
            return [SimpleNamespace(boxes=[])]
        conf = weak_confidences[seen["i"] % len(weak_confidences)]
        seen["i"] += 1
        return [SimpleNamespace(boxes=[_Box(SHIPWRECK_CLASS_ID, conf, located)])]

    detector = _detector_from_predict(_counting_predict(inner))
    meta, findings = detector.infer(_save(frame, tmp_path), "survey_cluster", "frame_0000")
    assert meta["inference_mode"] == "TILED"
    assert len(findings) == 1
    finding = findings[0]
    assert finding["candidate_recovery"] is True
    assert finding["evidence_count"] == 4
    assert finding["raw_class"] == "SHIPWRECK"
    assert finding["raw_confidence"] == pytest.approx(max(weak_confidences))  # exact model max, never overwritten
    assert finding["classification_source"] == "DEMO_HEURISTIC"
    assert finding["production_qualified"] is False
    assert finding["display_confidence_source"] == "SPATIAL_CONSENSUS_HEURISTIC"
    assert 0.55 <= finding["display_confidence"] <= 0.85
    # Recovery reports the envelope of coherent proposals, not an inset mean.
    x1, y1, x2, y2 = finding["bbox_px"]
    assert x1 <= 1150 and y1 <= 600 and x2 >= 1170 and y2 >= 620


def test_wrong_class_weak_proposals_ignored(tmp_path):
    """The same four-tile-overlap marker, but the weak detector reports class
    PIPELINE instead of SHIPWRECK -- must never be recovered."""
    frame = _blank_frame()
    frame[600:620, 1150:1170] = MARKER_VALUE
    pipeline_class_id = 0

    def inner(**kwargs):
        crop = kwargs["source"]
        located = _locate_marker(crop, MARKER_VALUE)
        if located is None or kwargs.get("conf") != RECOVERY_CONFIDENCE_FLOOR:
            return [SimpleNamespace(boxes=[])]
        return [SimpleNamespace(boxes=[_Box(pipeline_class_id, 0.03, located)])]

    detector = _detector_from_predict(_counting_predict(inner))
    _, findings = detector.infer(_save(frame, tmp_path), "survey_wrong_class", "frame_0000")
    assert findings == []


def test_regular_detections_bypass_fallback_completely(tmp_path):
    """A real >=0.12 SHIPWRECK detection must short-circuit the recovery path
    entirely -- the recovery pass (conf=RECOVERY_CONFIDENCE_FLOOR) is never
    even invoked, confirmed by the per-conf call counter."""
    frame = _blank_frame()
    frame[100:110, 100:110] = MARKER_VALUE

    def inner(**kwargs):
        crop = kwargs["source"]
        located = _locate_marker(crop, MARKER_VALUE)
        if located is None:
            return [SimpleNamespace(boxes=[])]
        if kwargs.get("conf") == TILE_CONFIDENCE_FLOOR:
            return [SimpleNamespace(boxes=[_Box(SHIPWRECK_CLASS_ID, 0.6, located)])]
        return [SimpleNamespace(boxes=[])]

    predict = _counting_predict(inner)
    detector = _detector_from_predict(predict)
    _, findings = detector.infer(_save(frame, tmp_path), "survey_bypass", "frame_0000")
    assert len(findings) == 1
    assert findings[0]["candidate_recovery"] is False
    assert findings[0]["raw_confidence"] == pytest.approx(0.6)
    assert RECOVERY_CONFIDENCE_FLOOR not in predict.calls  # the recovery pass never ran


def test_no_fallback_finding_without_a_coherent_cluster(tmp_path):
    """Two markers, each covered by only one tile (never overlapping), so
    every proposal is isolated -- no group ever reaches the >=3 support floor,
    even though two weak SHIPWRECK proposals genuinely exist."""
    frame = _blank_frame()
    frame[50:60, 50:60] = MARKER_VALUE  # tile (row0,col0) only: x<538, y<538
    frame[770:780, 100:110] = MARKER_VALUE  # tile (row1,col0) only: x<538, y in [768,800) is row1-exclusive

    def inner(**kwargs):
        crop = kwargs["source"]
        located = _locate_marker(crop, MARKER_VALUE)
        if located is None or kwargs.get("conf") != RECOVERY_CONFIDENCE_FLOOR:
            return [SimpleNamespace(boxes=[])]
        return [SimpleNamespace(boxes=[_Box(SHIPWRECK_CLASS_ID, 0.025, located)])]

    detector = _detector_from_predict(_counting_predict(inner))
    _, findings = detector.infer(_save(frame, tmp_path), "survey_no_cluster", "frame_0000")
    assert findings == []


def test_pipeline_and_crab_pot_never_trigger_or_receive_recovery(tmp_path):
    """A real >=0.12 PIPELINE detection (no SHIPWRECK at all) must still run
    the recovery pass (since the trigger is SHIPWRECK-absence, not
    any-class-absence) -- but even weak PIPELINE proposals it finds must never
    be recovered, since the fallback only ever gathers SHIPWRECK."""
    frame = _blank_frame()
    frame[100:110, 100:110] = MARKER_VALUE

    def inner(**kwargs):
        crop = kwargs["source"]
        located = _locate_marker(crop, MARKER_VALUE)
        if located is None:
            return [SimpleNamespace(boxes=[])]
        if kwargs.get("conf") == TILE_CONFIDENCE_FLOOR:
            return [SimpleNamespace(boxes=[_Box(0, 0.5, located)])]  # PIPELINE
        if kwargs.get("conf") == RECOVERY_CONFIDENCE_FLOOR:
            return [SimpleNamespace(boxes=[_Box(0, 0.03, located)])]  # weak PIPELINE, must be ignored
        return [SimpleNamespace(boxes=[])]

    detector = _detector_from_predict(_counting_predict(inner))
    _, findings = detector.infer(_save(frame, tmp_path), "survey_pipeline", "frame_0000")
    assert len(findings) == 1
    assert findings[0]["raw_class"] == "PIPELINE"
    assert findings[0]["candidate_recovery"] is False
