"""Round-2 ticket H0-3: an explicit runtime switch for the SHIPWRECK recovery pass (spec H0 item 3, I-H0-3, H0-AC3).

The recovery pass is an internal demo heuristic (Q4, KD-8). Scientific paths turn it off through an explicit
detector configuration switch, never by bypassing code; the production default is unchanged. A counter
records every entry into the recovery path, so "off" is proved rather than assumed. The frozen detector is
faked exactly as in test_weak_shipwreck_recovery.py.
"""
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from sagar.perception.runtime import RECOVERY_CONFIDENCE_FLOOR, SHIPWRECK_CLASS_ID, FinalDetector

WEIGHTS = Path("ml/artifacts/final_v1/detector/best.pt")
MARKER_VALUE = 200
WIDTH, HEIGHT = 1800, 800  # tiled: 4 x-tiles, 2 y-tiles


class _Value:
    def __init__(self, value):
        self._value = value

    def item(self):
        return self._value

    def tolist(self):
        return self._value


class _Box:
    def __init__(self, cls_id, conf, xyxy):
        self.cls, self.conf, self.xyxy = _Value(cls_id), _Value(conf), [_Value(list(xyxy))]


def _frame_with_recovery_cluster(tmp_path: Path) -> Path:
    """A marker in the overlap band of four tiles: at the recovery floor it yields a coherent cluster."""
    frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    frame[600:620, 1150:1170] = MARKER_VALUE
    path = tmp_path / "frame.png"
    Image.fromarray(frame).save(path)
    return path


def _predict_with_calls():
    """Weak SHIPWRECK proposals only at the recovery floor; nothing at the normal floor."""
    calls: dict = {}

    def predict(**kwargs):
        calls[kwargs.get("conf")] = calls.get(kwargs.get("conf"), 0) + 1
        crop = kwargs["source"]
        ys, xs = np.where(crop[:, :, 0] == MARKER_VALUE)
        if len(xs) == 0 or kwargs.get("conf") != RECOVERY_CONFIDENCE_FLOOR:
            return [SimpleNamespace(boxes=[])]
        box = (float(xs.min()), float(ys.min()), float(xs.max() + 1), float(ys.max() + 1))
        return [SimpleNamespace(boxes=[_Box(SHIPWRECK_CLASS_ID, 0.03, box)])]

    predict.calls = calls
    return predict


def _detector(**config) -> FinalDetector:
    detector = FinalDetector(WEIGHTS, **config)
    detector.load = lambda: None  # type: ignore[method-assign]
    detector.model = SimpleNamespace(predict=_predict_with_calls())
    return detector


def test_switch_off_gives_no_recovery_observation_and_never_enters_the_recovery_path(tmp_path):
    """H0-AC3."""
    detector = _detector(shipwreck_recovery=False)
    _, findings = detector.infer(_frame_with_recovery_cluster(tmp_path), "survey_off", "frame_0000")
    assert findings == []
    assert not any(finding["candidate_recovery"] for finding in findings)
    assert detector.recovery_invocations == 0
    assert detector.model.predict.calls.get(RECOVERY_CONFIDENCE_FLOOR, 0) == 0


def test_default_keeps_the_current_behaviour(tmp_path):
    """Production default unchanged: the same frame yields the one consolidated recovery finding."""
    detector = _detector()
    assert detector.shipwreck_recovery is True
    _, findings = detector.infer(_frame_with_recovery_cluster(tmp_path), "survey_default", "frame_0000")
    assert len(findings) == 1 and findings[0]["candidate_recovery"] is True and findings[0]["raw_class"] == "SHIPWRECK"
    assert detector.recovery_invocations == 1
    assert detector.model.predict.calls[RECOVERY_CONFIDENCE_FLOOR] > 0


def test_explicit_on_equals_the_default(tmp_path):
    frame = _frame_with_recovery_cluster(tmp_path)
    on, default = _detector(shipwreck_recovery=True), _detector()
    assert on.infer(frame, "s", "f")[1] == default.infer(frame, "s", "f")[1]


@pytest.mark.parametrize("value", ["false", "off", 0, 1, None, "False"])
def test_a_non_boolean_switch_value_fails_loudly(value):
    with pytest.raises(TypeError, match="shipwreck_recovery"):
        FinalDetector(WEIGHTS, shipwreck_recovery=value)


def test_a_misspelt_switch_fails_loudly():
    with pytest.raises(TypeError):
        FinalDetector(WEIGHTS, shipwreck_recovry=False)  # type: ignore[call-arg]


def test_the_switch_is_keyword_only():
    with pytest.raises(TypeError):
        FinalDetector(WEIGHTS, False)  # type: ignore[misc]


def test_the_recovery_path_refuses_to_run_when_switched_off(tmp_path):
    detector = _detector(shipwreck_recovery=False)
    with pytest.raises(RuntimeError, match="recovery"):
        detector._recover_weak_shipwreck_cluster(np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8), WIDTH, HEIGHT)
    assert detector.recovery_invocations == 0


def test_health_reports_the_switch():
    assert FinalDetector(WEIGHTS, shipwreck_recovery=False).health()["shipwreck_recovery"] is False
    assert FinalDetector(WEIGHTS).health()["shipwreck_recovery"] is True
