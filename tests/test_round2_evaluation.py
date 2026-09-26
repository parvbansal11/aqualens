"""Round-2 PID-06 matching and the H0-8 statistics (spec §7.3, §7.7, §7.8).

PID-06: class-aware score-ordered greedy one-to-one matching. Detections in descending raw confidence (ties by
x1, y1, x2, y2 ascending); each may match only an unmatched GT of its own class, the eligible GT of highest IoU
≥ τ (ties by GT x1, y1, x2, y2 ascending). τ = 0.5 primary, 0.3 secondary. Undefined rates are null, never 0.
"""
from __future__ import annotations

import math
import random

import pytest

from round2.evaluation import (
    IOU_THRESHOLDS, MATCHING_METHOD, box_iou, class_counts, clopper_pearson, cluster_bootstrap, match_image, rate,
)


def _det(cls, conf, box):
    return {"raw_class": cls, "raw_confidence": conf, "bbox_px": list(box)}


def _gt(cls, box):
    return {"class": cls, "xyxy_px": list(box)}


def test_thresholds_and_method_are_the_locked_ones():
    assert IOU_THRESHOLDS == {"primary": 0.5, "secondary": 0.3}
    assert MATCHING_METHOD.startswith("class_aware_score_ordered_greedy_one_to_one")


def test_iou_is_the_standard_area_ratio():
    assert box_iou([0, 0, 10, 10], [5, 0, 15, 10]) == pytest.approx(50 / 150)
    assert box_iou([0, 0, 10, 10], [10, 0, 20, 10]) == 0.0


def test_the_higher_scoring_detection_claims_the_gt_first():
    gt = [_gt("PIPELINE", (0, 0, 10, 10))]
    dets = [_det("PIPELINE", 0.4, (0, 0, 10, 10)), _det("PIPELINE", 0.9, (1, 0, 11, 10))]   # the 0.9 box has lower IoU
    tp, matched = match_image(dets, gt, 0.5)
    assert tp == [False, True] and matched == [True]


def test_each_detection_takes_the_highest_iou_unmatched_gt():
    gts = [_gt("CRAB_POT", (0, 0, 10, 10)), _gt("CRAB_POT", (2, 0, 12, 10))]
    dets = [_det("CRAB_POT", 0.9, (2, 0, 12, 10)), _det("CRAB_POT", 0.8, (0, 0, 10, 10))]
    tp, matched = match_image(dets, gts, 0.5)
    assert tp == [True, True] and matched == [True, True]


def test_matching_is_one_to_one():
    gt = [_gt("PIPELINE", (0, 0, 10, 10))]
    dets = [_det("PIPELINE", 0.9, (0, 0, 10, 10)), _det("PIPELINE", 0.8, (0, 0, 10, 10))]
    assert match_image(dets, gt, 0.5) == ([True, False], [True])


def test_matching_is_class_aware_with_no_rescue():
    gt = [_gt("SHIPWRECK", (0, 0, 10, 10))]
    assert match_image([_det("PIPELINE", 0.9, (0, 0, 10, 10))], gt, 0.5) == ([False], [False])


def test_the_iou_threshold_is_inclusive_and_distinguishes_primary_from_secondary():
    gt = [_gt("PIPELINE", (0, 0, 10, 10))]
    det = [_det("PIPELINE", 0.9, (0, 0, 10, 20))]          # IoU exactly 0.5
    assert match_image(det, gt, 0.5)[0] == [True]
    det = [_det("PIPELINE", 0.9, (0, 0, 10, 25))]          # IoU 0.4: secondary only
    assert match_image(det, gt, 0.5)[0] == [False] and match_image(det, gt, 0.3)[0] == [True]


def test_score_ties_break_by_coordinates_not_input_order():
    gt = [_gt("PIPELINE", (0, 0, 10, 10))]
    a, b = _det("PIPELINE", 0.5, (0, 0, 10, 11)), _det("PIPELINE", 0.5, (0, 0, 11, 10))
    assert match_image([a, b], gt, 0.5)[0] == [True, False]      # (0,0,10,11) < (0,0,11,10)
    assert match_image([b, a], gt, 0.5)[0] == [False, True]


def test_gt_iou_ties_break_by_gt_coordinates():
    gts = [_gt("PIPELINE", (2, 0, 12, 10)), _gt("PIPELINE", (-2, 0, 8, 10))]   # equal IoU with the detection
    tp, matched = match_image([_det("PIPELINE", 0.9, (0, 0, 10, 10))], gts, 0.5)
    assert tp == [True] and matched == [False, True]              # (-2, …) sorts first


def test_matching_counts_are_row_order_invariant():
    rng = random.Random(0)
    gts = [_gt(rng.choice(["A", "B"]), (x, 0, x + 10, 10)) for x in range(0, 100, 7)]
    dets = [_det(rng.choice(["A", "B"]), round(rng.random(), 3), (x + rng.randint(-3, 3), 0, x + 10, 10)) for x in range(0, 100, 5)]
    base = class_counts(dets, gts, 0.5)
    for seed in range(5):
        random.Random(seed).shuffle(dets)
        random.Random(seed + 9).shuffle(gts)
        assert class_counts(dets, gts, 0.5) == base


def test_class_counts_keep_unmatched_detections_and_gt_per_class():
    gts = [_gt("A", (0, 0, 10, 10)), _gt("A", (50, 0, 60, 10))]
    dets = [_det("A", 0.9, (0, 0, 10, 10)), _det("B", 0.8, (50, 0, 60, 10))]
    assert class_counts(dets, gts, 0.5) == {"A": {"tp": 1, "detections": 1, "gt": 2}, "B": {"tp": 0, "detections": 1, "gt": 0}}


# --- rates: undefined is null, never 0

def test_undefined_rates_are_none():
    assert rate(0, 0) is None and rate(3, 4) == 0.75


def test_clopper_pearson_matches_known_values():
    lo, hi = clopper_pearson(5, 10)
    assert lo == pytest.approx(0.187086, abs=1e-5) and hi == pytest.approx(0.812914, abs=1e-5)
    assert clopper_pearson(0, 10)[0] == 0.0 and clopper_pearson(10, 10)[1] == 1.0
    assert clopper_pearson(0, 0) == (None, None)


def test_cluster_bootstrap_is_deterministic_resamples_groups_and_reports_undefined_draws():
    units = [{"group": g, "num": n, "den": d} for g, n, d in [("g1", 1, 2), ("g1", 1, 1), ("g2", 0, 3), ("g3", 2, 2)]]
    first = cluster_bootstrap(units, b=1000, seed=7)
    assert first == cluster_bootstrap(list(reversed(units)), b=1000, seed=7)
    assert 0 <= first["ci_low"] <= first["point"] <= first["ci_high"] <= 1 and first["b"] == 1000 and first["groups"] == 3
    assert first["point"] == pytest.approx(4 / 8)
    empty = cluster_bootstrap([{"group": "g", "num": 0, "den": 0}], b=1000, seed=7)
    assert empty["point"] is None and empty["ci_low"] is None and empty["undefined_draws"] == 1000
