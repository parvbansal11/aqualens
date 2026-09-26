from pathlib import Path
from sagar.perception.demo_policy import shipwreck_demo_presentation
from sagar.perception.runtime import EXPECTED_SHA256, sha256


def test_final_artifact_sha_is_exact():
    path = Path("ml/artifacts/final_v1/detector/best.pt")
    assert path.is_file() and sha256(path) == EXPECTED_SHA256


def test_demo_policy_preserves_raw_boundary_and_is_not_production():
    view = shipwreck_demo_presentation("SHIPWRECK", 0.2)
    assert view == {"display_class": "SHIPWRECK", "display_confidence": 0.72, "classification_source": "DEMO_HEURISTIC", "production_qualified": False}
    assert shipwreck_demo_presentation("PIPELINE", .8)["production_qualified"] is True


def test_runtime_detection_ids_are_unique_across_source_frames():
    """A finding id keys selection, review writes and export rows in the UI, so it
    must be unique within a survey even when several frames each detect a target."""
    from types import SimpleNamespace

    import numpy as np
    from PIL import Image

    from sagar.perception.runtime import FinalDetector

    class _Value:
        def __init__(self, value): self._value = value
        def item(self): return self._value
        def tolist(self): return self._value

    class _Box:
        cls = _Value(2)
        conf = _Value(0.5)
        xyxy = [_Value([1.0, 2.0, 3.0, 4.0])]

    detector = FinalDetector(Path("ml/artifacts/final_v1/detector/best.pt"))
    detector.load = lambda: None  # type: ignore[method-assign]
    detector.model = SimpleNamespace(
        predict=lambda **_: [SimpleNamespace(boxes=[_Box(), _Box()])]
    )

    tmp = Path("data/runtime/_id_uniqueness_probe.png")
    tmp.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.zeros((8, 8, 3), dtype=np.uint8)).save(tmp)
    try:
        ids = []
        for frame in ("frame_0000", "frame_0001"):
            _, findings = detector.infer(tmp, "survey_probe", frame)
            ids.extend(item["detection_id"] for item in findings)
    finally:
        tmp.unlink(missing_ok=True)

    assert len(ids) == 4
    assert len(set(ids)) == 4


def test_ndarray_inference_uses_bgr_contract(tmp_path):
    """PIL source pixels are RGB; Ultralytics ndarray sources are OpenCV/BGR."""
    from types import SimpleNamespace
    import numpy as np
    from PIL import Image
    from sagar.perception.runtime import FinalDetector

    seen = []
    detector = FinalDetector(Path("ml/artifacts/final_v1/detector/best.pt"))
    detector.load = lambda: None  # type: ignore[method-assign]
    detector.model = SimpleNamespace(predict=lambda **kwargs: seen.append(kwargs["source"][0, 0].tolist()) or [SimpleNamespace(boxes=[])])
    path = tmp_path / "rgb.png"
    Image.fromarray(np.array([[[10, 20, 30]]], dtype=np.uint8), "RGB").save(path)
    detector.infer(path, "survey", "frame_0000")
    assert seen == [[30, 20, 10]]
