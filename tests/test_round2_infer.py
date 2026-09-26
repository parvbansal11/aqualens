"""Round-2 ticket H0-4: harness inference is the production detection path (spec H0 item 3, H0-AC4, I-H0-2, I-H0-3).

The harness calls FinalDetector.infer, the path the service runs, with the SHIPWRECK recovery pass switched off
(H0-3). Its detections are the production detections' raw fields (class, box, score), never the presentation
fields. For a tiled and a full-frame fixture they equal the production path's detections at identical floors. The
frozen model is faked as in the runtime tiling tests; the weights file is the real frozen artifact (its SHA is
checked).
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

import sagar.perception.runtime as runtime
from round2.guards import GroundTruthAccessError, reference_view
from round2.infer import (
    RAW_DETECTION_FIELDS, ScientificPathError, inference_config, infer_row, scientific_detector,
)
from sagar.perception.runtime import (
    RECOVERY_CONFIDENCE_FLOOR, SHIPWRECK_CLASS_ID, TILE_CONFIDENCE_FLOOR, FinalDetector,
)

WEIGHTS = Path("ml/artifacts/final_v1/detector/best.pt")
MARKERS = {50: 0, 100: 1, 150: 2}  # marker pixel value -> class id (PIPELINE, SHIPWRECK, CRAB_POT)


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


def _fake_predict():
    """One box per marker present in the crop, scored by marker; records the floor of every call."""
    calls: list = []

    def predict(**kwargs):
        calls.append(kwargs.get("conf"))
        crop, boxes = kwargs["source"], []
        for value, class_id in MARKERS.items():
            ys, xs = np.where(crop[:, :, 0] == value)
            if len(xs):
                boxes.append(_Box(class_id, round(0.2 + value / 1000, 3), (float(xs.min()), float(ys.min()), float(xs.max() + 1), float(ys.max() + 1))))
        return [SimpleNamespace(boxes=boxes)]

    predict.calls = calls
    return predict


def _faked(detector: FinalDetector) -> FinalDetector:
    detector.load = lambda: None  # type: ignore[method-assign]
    detector.model = SimpleNamespace(predict=_fake_predict())
    return detector


def _frame(tmp_path: Path, name: str, size: tuple[int, int]) -> Path:
    width, height = size
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    frame[20:40, 30:60] = 50        # PIPELINE
    frame[200:260, 400:470] = 100   # SHIPWRECK
    frame[300:330, 100:120] = 150   # CRAB_POT
    path = tmp_path / name
    Image.fromarray(frame).save(path)
    return path


def _row(path: Path, root: Path, **extra) -> dict:
    return {"image_id": path.stem, "dataset": "SUBPIPE", "sensor": "Klein 3500", "channel": "HF", "split": "val",
            "survey_id": "SUBPIPE:HF:1.0", "bootstrap_group": "SUBPIPE:HF:1.0:block0", "augmentation_parent": None,
            "source_path": path.name, "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "gt_boxes": [{"class": "PIPELINE", "xyxy_px": [30.0, 20.0, 60.0, 40.0]}], "gt_object_regions": None,
            "gt_object_regions_status": "NOT_APPLICABLE", "gt_boxes_derivation": "BBOX", **extra}


FIXTURES = [("tiled", (1800, 800), "TILED"), ("full_frame", (640, 640), "FULL_FRAME")]


def _production(path: Path, *, recovery: bool) -> list[tuple]:
    detector = _faked(FinalDetector(WEIGHTS, shipwreck_recovery=recovery))
    _, findings = detector.infer(path, "survey_prod", path.stem)
    return [(f["raw_class"], f["bbox_px"], f["raw_confidence"]) for f in findings]


def _harness(path: Path, root: Path, detector: FinalDetector | None = None) -> dict:
    return infer_row(detector or _faked(scientific_detector()), _row(path, root), root)


# --- H0-AC4: equivalence to the production path

@pytest.mark.parametrize("name, size, mode", FIXTURES, ids=[f[0] for f in FIXTURES])
def test_harness_detections_equal_production_detections_with_recovery_off(tmp_path, name, size, mode):
    path = _frame(tmp_path, f"{name}.png", size)
    result = _harness(path, tmp_path)
    harness = [(d["raw_class"], d["bbox_px"], d["raw_confidence"]) for d in result["detections"]]
    assert harness == _production(path, recovery=False)
    assert len(harness) == 3 and result["inference_mode"] == mode
    # A SHIPWRECK survives the normal pass, so the default production path (recovery on) never recovers: equal too.
    assert harness == _production(path, recovery=True)


@pytest.mark.parametrize("name, size, mode", FIXTURES, ids=[f[0] for f in FIXTURES])
def test_harness_uses_the_production_floors(tmp_path, name, size, mode):
    detector = _faked(scientific_detector())
    _harness(_frame(tmp_path, f"{name}.png", size), tmp_path, detector)
    expected = TILE_CONFIDENCE_FLOOR if mode == "TILED" else None   # full frame: the Ultralytics default
    assert set(detector.model.predict.calls) == {expected}


# --- recovery is off, provably

def test_the_harness_detector_has_recovery_switched_off_and_never_enters_it(tmp_path):
    detector = _faked(scientific_detector())
    assert detector.shipwreck_recovery is False
    frame = np.zeros((800, 1800, 3), dtype=np.uint8)   # nothing survives the normal pass: recovery would be eligible
    path = tmp_path / "empty.png"
    Image.fromarray(frame).save(path)
    result = infer_row(detector, _row(path, tmp_path), tmp_path)
    assert result["detections"] == [] and result["recovery_invocations"] == 0
    assert detector.recovery_invocations == 0 and RECOVERY_CONFIDENCE_FLOOR not in detector.model.predict.calls


def test_a_detector_with_recovery_on_is_refused(tmp_path):
    path = _frame(tmp_path, "f.png", (640, 640))
    with pytest.raises(ScientificPathError, match="recovery"):
        infer_row(_faked(FinalDetector(WEIGHTS)), _row(path, tmp_path), tmp_path)


def test_a_recovery_finding_is_refused_even_if_one_appears(tmp_path, monkeypatch):
    path = _frame(tmp_path, "f.png", (640, 640))
    detector = _faked(scientific_detector())
    original = detector.infer

    def leaky_infer(*args, **kwargs):
        meta, findings = original(*args, **kwargs)
        findings[0]["candidate_recovery"] = True
        return meta, findings

    monkeypatch.setattr(detector, "infer", leaky_infer)
    with pytest.raises(ScientificPathError, match="recovery"):
        infer_row(detector, _row(path, tmp_path), tmp_path)


# --- raw outputs only; presentation cannot reach them

def test_only_raw_detector_fields_are_recorded(tmp_path):
    result = _harness(_frame(tmp_path, "f.png", (640, 640)), tmp_path)
    assert RAW_DETECTION_FIELDS == ("raw_class_id", "raw_class", "raw_confidence", "bbox_px", "tile_id")
    for detection in result["detections"]:
        assert set(detection) == set(RAW_DETECTION_FIELDS)
    assert not any("display" in key for key in result)


def test_changing_the_presentation_layer_cannot_change_harness_output(tmp_path, monkeypatch):
    path = _frame(tmp_path, "f.png", (1800, 800))
    baseline = _harness(path, tmp_path)

    def absurd_presentation(*_args, **_kwargs):
        return {"display_class": "PIPELINE", "display_confidence": 0.99, "classification_source": "TAMPERED",
                "production_qualified": True, "display_label": "tampered"}

    monkeypatch.setattr(runtime, "shipwreck_demo_presentation", absurd_presentation)
    tampered_production = _faked(scientific_detector()).infer(path, "s", "f")[1]
    assert {f["display_confidence"] for f in tampered_production} == {0.99}   # the presentation did change...
    assert _harness(path, tmp_path) == baseline                                # ...the harness output did not


# --- inputs: frozen detector, verified source, no ground truth

def test_ground_truth_never_reaches_inference(tmp_path):
    path = _frame(tmp_path, "f.png", (640, 640))
    row = _row(path, tmp_path)
    with_gt = infer_row(_faked(scientific_detector()), row, tmp_path)
    gt_free = infer_row(_faked(scientific_detector()), reference_view([row])[0], tmp_path)
    assert with_gt == gt_free
    assert not any(key.startswith("gt_") for key in with_gt)
    with pytest.raises(GroundTruthAccessError):
        reference_view([row])[0]["gt_boxes"]


def test_a_source_that_does_not_match_its_manifest_sha256_is_refused(tmp_path):
    path = _frame(tmp_path, "f.png", (640, 640))
    with pytest.raises(ScientificPathError, match="SHA-256"):
        infer_row(_faked(scientific_detector()), _row(path, tmp_path, source_sha256="0" * 64), tmp_path)


def test_a_detector_that_is_not_the_frozen_artifact_is_refused(tmp_path):
    other = tmp_path / "other.pt"
    other.write_bytes(b"not the frozen detector")
    path = _frame(tmp_path, "f.png", (640, 640))
    with pytest.raises(ScientificPathError, match="SHA"):
        infer_row(_faked(FinalDetector(other, shipwreck_recovery=False)), _row(path, tmp_path), tmp_path)


def test_identity_fields_travel_with_every_result(tmp_path):
    result = _harness(_frame(tmp_path, "f.png", (640, 640)), tmp_path)
    for key in ("image_id", "dataset", "sensor", "channel", "split", "survey_id", "bootstrap_group"):
        assert key in result


# --- declared floor override (spec H0 item 3): lower only, explicit, recorded

@pytest.mark.parametrize("name, size, mode", FIXTURES, ids=[f[0] for f in FIXTURES])
def test_a_declared_floor_override_reaches_both_production_paths_and_is_recorded(tmp_path, name, size, mode):
    detector = _faked(scientific_detector(floor_override=0.05))
    result = _harness(_frame(tmp_path, f"{name}.png", size), tmp_path, detector)
    assert set(detector.model.predict.calls) == {0.05}
    assert result["inference_config"]["floor_override"] == 0.05


def test_config_records_the_production_floors_without_an_override():
    config = inference_config(_faked(scientific_detector()))
    assert config["shipwreck_recovery"] is False and config["floor_override"] is None
    assert config["floors"] == {"TILED": TILE_CONFIDENCE_FLOOR, "FULL_FRAME": "ULTRALYTICS_DEFAULT"}
    assert config["detector_sha256"] == runtime.EXPECTED_SHA256
    assert config["raw_detection_fields"] == list(RAW_DETECTION_FIELDS)


@pytest.mark.parametrize("value", [0.2, 0.5, 0.0, -0.1, True, "0.05"])
def test_an_override_that_does_not_lower_the_floor_or_is_not_a_number_fails_loudly(value):
    with pytest.raises((TypeError, ValueError), match="confidence_floor"):
        FinalDetector(WEIGHTS, confidence_floor=value)


def test_production_default_is_unchanged():
    detector = FinalDetector(WEIGHTS)
    assert detector.shipwreck_recovery is True and detector.confidence_floor is None


# --- the real frozen detector (synthetic fixture images only; no corpus data)

@pytest.mark.parametrize("name, size, mode", FIXTURES, ids=[f[0] for f in FIXTURES])
def test_real_frozen_detector_harness_equals_production(tmp_path, name, size, mode):
    rng = np.random.default_rng(0)
    width, height = size
    image = rng.gamma(2.0, 30.0, (height, width)).clip(0, 255).astype(np.uint8)
    image[height // 3:height // 3 + 40, width // 4:width // 4 + 200] = 230
    image[height // 3 + 40:height // 3 + 90, width // 4:width // 4 + 200] = 5
    path = tmp_path / f"{name}.png"
    Image.fromarray(image).save(path)
    detector = scientific_detector()
    result = infer_row(detector, _row(path, tmp_path), tmp_path)
    production = FinalDetector(WEIGHTS, shipwreck_recovery=False)
    _, findings = production.infer(path, "survey_prod", path.stem)
    assert [(d["raw_class"], d["bbox_px"], d["raw_confidence"]) for d in result["detections"]] == [
        (f["raw_class"], f["bbox_px"], f["raw_confidence"]) for f in findings]
    assert result["inference_mode"] == mode
    assert detector.model is not None and detector.recovery_invocations == production.recovery_invocations == 0
    assert result["inference_config"]["detector_sha256"] == runtime.EXPECTED_SHA256
