"""Round-2 ticket H0-8: the first runtime-path detector baseline (spec H0 required experiment, §7.3; PID-05, PID-06).

Runtime-floor detections are the production path's own (H0-5's same-pass records); a second run at the PID-05 sweep
floor 0.001 is cached for later sweeps with its per-pass max_det saturation. Metrics are computed on test only, per
dataset × sensor × class × IoU (0.5 primary, 0.3 secondary). AI4 is FRAGMENT-LEVEL (object level UNAVAILABLE pending
PID-01); PING's primary population is the 324 one-per-parent representatives, all variants a SENSITIVITY population.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

import sagar.perception.runtime as runtime
from round2.baseline import (
    MAX_DET, SWEEP_FLOOR, BaselineError, evaluate_population, populations, sweep_infer_row, write_baseline,
)
from round2.infer import infer_row, scientific_detector
from sagar.perception.runtime import FinalDetector

WEIGHTS = Path("ml/artifacts/final_v1/detector/best.pt")
CLASS_OF = {50: 0, 100: 1, 150: 2}


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


def _fake(saturate: bool = False):
    calls = []

    def predict(**kwargs):
        calls.append(kwargs.get("conf"))
        crop, boxes = kwargs["source"], []
        if saturate:
            boxes = [_Box(0, 0.002, (float(i), 0.0, float(i) + 4, 4.0)) for i in range(MAX_DET)]
        for value, class_id in CLASS_OF.items():
            ys, xs = np.where(crop[:, :, 0] == value)
            if len(xs):
                boxes.append(_Box(class_id, 0.6, (float(xs.min()), float(ys.min()), float(xs.max() + 1), float(ys.max() + 1))))
        return [SimpleNamespace(boxes=boxes)]

    predict.calls = calls
    return predict


def _faked(detector: FinalDetector, **kw) -> FinalDetector:
    detector.load = lambda: None  # type: ignore[method-assign]
    detector.model = SimpleNamespace(predict=_fake(**kw))
    return detector


def _image(root: Path, name: str, size, marker: int, mode: str) -> Path:
    width, height = size
    pixels = np.zeros((height, width, 3), dtype=np.uint8)
    pixels[20:60, 30:90] = marker
    path = root / f"{name}.png"
    Image.fromarray(pixels if mode == "RGB" else pixels[:, :, 0], mode=mode).save(path)
    return path


def _row(path: Path, dataset: str, split: str, gt_class: str, **extra) -> dict:
    with Image.open(path) as image:
        width, height = image.size
    return {"image_id": path.stem, "dataset": dataset, "sensor": {"SUBPIPE": "Klein 3500", "AI4SHIPWRECKS": "EdgeTech 2205", "PING_GHOSTVISION": "Humminbird"}[dataset],
            "channel": extra.pop("channel", None), "split": split, "survey_id": f"S:{path.stem}", "bootstrap_group": extra.pop("group", f"G:{path.stem}"),
            "augmentation_parent": extra.pop("parent", None), "source_path": path.name, "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "image_width": width, "image_height": height, "gt_boxes": [{"class": gt_class, "xyxy_px": [30.0, 20.0, 90.0, 60.0]}],
            "gt_object_regions": None, "gt_object_regions_status": "NOT_APPLICABLE", "gt_boxes_derivation": "BBOX", **extra}


def _corpus(tmp_path: Path):
    root = tmp_path / "corpus"
    root.mkdir()
    rows = [
        _row(_image(root, "sp_hf", (1800, 800), 50, "L"), "SUBPIPE", "test", "PIPELINE", channel="HF"),
        _row(_image(root, "sp_lf", (1800, 800), 50, "L"), "SUBPIPE", "test", "PIPELINE", channel="LF"),
        _row(_image(root, "ai4", (1800, 800), 150, "L"), "AI4SHIPWRECKS", "test", "SHIPWRECK", gt_boxes_derivation="BBOX_FROM_CONNECTED_COMPONENTS"),
        _row(_image(root, "ping_a1", (640, 640), 150, "RGB"), "PING_GHOSTVISION", "test", "CRAB_POT", parent="P1", group="rec1"),
        _row(_image(root, "ping_a2", (640, 640), 150, "RGB"), "PING_GHOSTVISION", "test", "CRAB_POT", parent="P1", group="rec1"),
        _row(_image(root, "ping_b1", (640, 640), 0, "RGB"), "PING_GHOSTVISION", "test", "CRAB_POT", parent="P2", group="rec2"),
        _row(_image(root, "val_sp", (1800, 800), 50, "L"), "SUBPIPE", "val", "PIPELINE", channel="HF"),
    ]
    reps = [{"split": "test", "augmentation_parent": "P1", "image_id": "ping_a1", "sibling_count": 2},
            {"split": "test", "augmentation_parent": "P2", "image_id": "ping_b1", "sibling_count": 1}]
    runtime_records = []
    detector = _faked(scientific_detector())
    for row in rows:
        result = infer_row(detector, row, root)
        runtime_records.append({k: v for k, v in result.items() if k != "inference_config"})
    return root, rows, reps, runtime_records


# --- the sweep run

@pytest.mark.parametrize("size, mode", [((1800, 800), "TILED"), ((640, 640), "FULL_FRAME")])
def test_the_sweep_run_uses_0_001_on_both_paths_and_counts_raw_boxes_per_pass(tmp_path, size, mode):
    root = tmp_path
    row = _row(_image(root, "x", size, 50, "L" if mode == "TILED" else "RGB"), "SUBPIPE", "val", "PIPELINE")
    detector = _faked(scientific_detector(floor_override=SWEEP_FLOOR))
    result, passes = sweep_infer_row(detector, row, root)
    assert SWEEP_FLOOR == 0.001 and set(detector.model.predict.calls) == {0.001}
    assert len(passes) == (result["tile_count"] or 1) and all(p["saturated"] is False for p in passes)
    assert detector.recovery_invocations == 0


def test_max_det_saturation_is_recorded(tmp_path):
    row = _row(_image(tmp_path, "x", (640, 640), 50, "RGB"), "PING_GHOSTVISION", "val", "CRAB_POT")
    _, passes = sweep_infer_row(_faked(scientific_detector(floor_override=SWEEP_FLOOR), saturate=True), row, tmp_path)
    assert MAX_DET == 300 and passes[0]["raw_boxes"] == 301 and passes[0]["saturated"] is True


def test_the_sweep_run_refuses_any_floor_but_the_locked_one(tmp_path):
    row = _row(_image(tmp_path, "x", (640, 640), 50, "RGB"), "PING_GHOSTVISION", "val", "CRAB_POT")
    with pytest.raises(BaselineError, match="0.001"):
        sweep_infer_row(_faked(scientific_detector()), row, tmp_path)


# --- populations and evaluation

def test_populations_separate_sensors_label_ai4_fragments_and_split_ping_primary_from_sensitivity(tmp_path):
    _, rows, reps, _ = _corpus(tmp_path)
    pops = populations([r for r in rows if r["split"] == "test"], reps)
    assert {k: len(v["rows"]) for k, v in pops.items()} == {
        "SUBPIPE|Klein 3500|ALL_TEST": 2, "SUBPIPE|Klein 3500|HF": 1, "SUBPIPE|Klein 3500|LF": 1,
        "AI4SHIPWRECKS|EdgeTech 2205|FRAGMENT_LEVEL": 1,
        "PING_GHOSTVISION|Humminbird|PRIMARY_ONE_PER_PARENT": 2, "PING_GHOSTVISION|Humminbird|SENSITIVITY_ALL_VARIANTS": 3}
    assert pops["AI4SHIPWRECKS|EdgeTech 2205|FRAGMENT_LEVEL"]["evaluation_level"] == "FRAGMENT_LEVEL"
    assert pops["PING_GHOSTVISION|Humminbird|SENSITIVITY_ALL_VARIANTS"]["role"] == "SENSITIVITY"
    assert pops["PING_GHOSTVISION|Humminbird|PRIMARY_ONE_PER_PARENT"]["role"] == "PRIMARY"
    assert {r["image_id"] for r in pops["PING_GHOSTVISION|Humminbird|PRIMARY_ONE_PER_PARENT"]["rows"]} == {"ping_a1", "ping_b1"}


def test_val_rows_are_never_evaluated(tmp_path):
    _, rows, reps, _ = _corpus(tmp_path)
    with pytest.raises(BaselineError, match="test"):
        populations(rows, reps)


def test_metrics_read_raw_fields_only_and_undefined_rates_are_null(tmp_path):
    _, rows, reps, runtime_records = _corpus(tmp_path)
    detections = {r["image_id"]: r["detections"] for r in runtime_records}
    pop = populations([r for r in rows if r["split"] == "test"], reps)["AI4SHIPWRECKS|EdgeTech 2205|FRAGMENT_LEVEL"]
    base = evaluate_population(pop, detections, b=200, seed=1)
    tampered = {k: [{**d, "display_class": "PIPELINE", "display_confidence": 0.99} for d in v] for k, v in detections.items()}
    assert evaluate_population(pop, tampered, b=200, seed=1) == base
    ship = base["by_iou"]["0.5"]["SHIPWRECK"]
    assert ship["gt"] == 1 and ship["detections"] == 0 and ship["precision"]["point"] is None and ship["recall"]["point"] == 0.0
    assert ship["recall"]["for_claims"] is False            # n < 30 events (spec §7.8)
    crab = base["by_iou"]["0.5"]["CRAB_POT"]
    assert crab["gt"] == 0 and crab["recall"]["point"] is None and crab["precision"]["point"] == 0.0


# --- the artifact

def test_the_artifact_records_provenance_and_is_deterministic_and_immutable(tmp_path):
    root, rows, reps, runtime_records = _corpus(tmp_path)
    runtime_path = tmp_path / "runtime_records.jsonl"
    runtime_path.write_text("".join(json.dumps(r, sort_keys=True) + "\n" for r in runtime_records))
    kwargs = dict(corpus_root=root, manifest_rows=rows, ping_representatives=reps, runtime_records_path=runtime_path,
                  runtime_records_sha256=None, manifest_sha256="f" * 64, bootstrap_b=200)
    first = tmp_path / "a" / "iter-1"
    provenance = write_baseline(first, detector=_faked(scientific_detector(floor_override=SWEEP_FLOOR)), **kwargs)
    assert provenance["sweep"]["confidence_floor"] == 0.001 and provenance["sweep"]["max_det"] == 300
    assert provenance["sweep"]["saturated_passes"] == 0 and provenance["recovery_invocations"] == 0
    assert provenance["production_floors"] == {"TILED": 0.12, "FULL_FRAME": "ULTRALYTICS_DEFAULT (0.25 at ultralytics 8.4.135)"}
    assert provenance["matching_method"].startswith("class_aware_score_ordered_greedy") and provenance["iou_thresholds"] == {"primary": 0.5, "secondary": 0.3}
    assert provenance["ai4"] == {"fragment_level": "AVAILABLE", "object_level": "UNAVAILABLE_PENDING_PID_01"}
    assert provenance["sweep_consistency"]["images_where_filtered_sweep_differs_from_runtime"] == 0
    metrics = json.loads((first / "metrics.json").read_text())
    assert "val" not in json.dumps(sorted(metrics["populations"]))
    second = tmp_path / "b" / "iter-1"
    write_baseline(second, detector=_faked(scientific_detector(floor_override=SWEEP_FLOOR)), **kwargs)
    for name in ("metrics.json", "sweep/test.jsonl", "sweep/val.jsonl", "test_match_labels.jsonl"):
        assert (first / name).read_bytes() == (second / name).read_bytes()
    for name in ("sweep/test.jsonl", "sweep/val.jsonl"):
        assert not any(k.startswith("gt_") or "display" in k for line in (first / name).read_text().splitlines() for k in json.loads(line))
    with pytest.raises(BaselineError, match="immutable"):
        write_baseline(first, detector=_faked(scientific_detector(floor_override=SWEEP_FLOOR)), **kwargs)


def test_the_report_flags_precision_and_recall_claims_separately():
    from round2.baseline import _markdown
    stat = lambda point, claims: {"point": point, "ci_low": point, "ci_high": point, "for_claims": claims}  # noqa: E731
    metrics = {"populations": {"AI4": {"role": "PRIMARY", "evaluation_level": "FRAGMENT_LEVEL", "images": 120, "bootstrap_groups": 13,
                                       "by_iou": {"0.5": {"SHIPWRECK": {"tp": 0, "detections": 0, "gt": 347,
                                                                        "precision": stat(None, False), "recall": stat(0.0, True)}}}}},
               "training_representation": {"heldout_test_per_class": {}}}
    row = next(line for line in _markdown(metrics).splitlines() if line.startswith("| SHIPWRECK"))
    assert "no (n = 0 < 30)" in row and row.rstrip().endswith("| yes |")
