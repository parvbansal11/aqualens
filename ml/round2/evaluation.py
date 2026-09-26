"""PID-06 matching and the H0-8 statistics (spec §7.3 cluster bootstrap, §7.7 rates never replaced by 0, §7.8 n < 30).

PID-06 (locked): class-aware score-ordered greedy one-to-one matching. Detections are taken in descending raw
confidence (ties by bbox x1, y1, x2, y2 ascending); each may match only an unmatched GT box of its own class, the
eligible one of highest IoU ≥ τ (ties by GT x1, y1, x2, y2 ascending). τ is 0.5 (primary) and 0.3 (secondary).
Only raw detector fields are read.
"""
from __future__ import annotations

import math
import random
from typing import Any, Iterable, Mapping, Sequence

MATCHING_METHOD = "class_aware_score_ordered_greedy_one_to_one@v1"
IOU_THRESHOLDS = {"primary": 0.5, "secondary": 0.3}
MIN_EVENTS_FOR_CLAIMS = 30   # spec §7.8


def box_iou(a: Sequence[float], b: Sequence[float]) -> float:
    width, height = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
    if width <= 0 or height <= 0:
        return 0.0
    inter = width * height
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def match_image(detections: Sequence[Mapping[str, Any]], gt_boxes: Sequence[Mapping[str, Any]], tau: float) -> tuple[list[bool], list[bool]]:
    """PID-06 on one image: (TP flag per detection, matched flag per GT box), both in input order."""
    order = sorted(range(len(detections)), key=lambda i: (-detections[i]["raw_confidence"], *detections[i]["bbox_px"]))
    gt_order = sorted(range(len(gt_boxes)), key=lambda j: tuple(gt_boxes[j]["xyxy_px"]))
    tp, matched = [False] * len(detections), [False] * len(gt_boxes)
    for i in order:
        best, best_iou = None, -1.0
        for j in gt_order:
            if matched[j] or gt_boxes[j]["class"] != detections[i]["raw_class"]:
                continue
            iou = box_iou(detections[i]["bbox_px"], gt_boxes[j]["xyxy_px"])
            if iou >= tau and iou > best_iou:   # strict: the first in GT coordinate order wins ties
                best, best_iou = j, iou
        if best is not None:
            tp[i], matched[best] = True, True
    return tp, matched


def class_counts(detections: Sequence[Mapping[str, Any]], gt_boxes: Sequence[Mapping[str, Any]], tau: float) -> dict[str, dict[str, int]]:
    """Per class: TP, detections and GT boxes on one image under PID-06."""
    tp, _ = match_image(detections, gt_boxes, tau)
    counts: dict[str, dict[str, int]] = {}
    for detection, hit in zip(detections, tp):
        entry = counts.setdefault(detection["raw_class"], {"tp": 0, "detections": 0, "gt": 0})
        entry["detections"] += 1
        entry["tp"] += int(hit)
    for gt in gt_boxes:
        counts.setdefault(gt["class"], {"tp": 0, "detections": 0, "gt": 0})["gt"] += 1
    return dict(sorted(counts.items()))


def rate(numerator: int, denominator: int) -> float | None:
    """A rate, or None when undefined (spec §7.7: missing evidence is never replaced by 0)."""
    return numerator / denominator if denominator else None


def _log_binom_pmf(k: int, n: int, p: float) -> float:
    if p <= 0.0:
        return 0.0 if k == 0 else -math.inf
    if p >= 1.0:
        return 0.0 if k == n else -math.inf
    return math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1) + k * math.log(p) + (n - k) * math.log1p(-p)


def _binom_cdf(k: int, n: int, p: float) -> float:
    return min(1.0, sum(math.exp(_log_binom_pmf(i, n, p)) for i in range(k + 1)))


def clopper_pearson(k: int, n: int, alpha: float = 0.05) -> tuple[float | None, float | None]:
    """Exact two-sided binomial interval, by inverting the binomial CDF."""
    if n == 0:
        return None, None
    # P(X >= k | p_lo) = alpha/2 and P(X <= k | p_hi) = alpha/2
    lower = 0.0 if k == 0 else _solve_increasing(lambda p: 1.0 - _binom_cdf(k - 1, n, p), alpha / 2)
    upper = 1.0 if k == n else _solve_decreasing(lambda p: _binom_cdf(k, n, p), alpha / 2)
    return lower, upper


def _solve_increasing(function, target: float) -> float:
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if function(mid) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _solve_decreasing(function, target: float) -> float:
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if function(mid) > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def cluster_bootstrap(units: Iterable[Mapping[str, Any]], *, b: int, seed: int, alpha: float = 0.05) -> dict[str, Any]:
    """Percentile CI of a pooled rate Σnum / Σden, resampling bootstrap groups with replacement (spec §7.3).

    Draws whose resampled denominator is 0 are undefined; they are counted and excluded, never scored as 0.
    """
    groups: dict[str, list[int]] = {}
    for unit in units:
        entry = groups.setdefault(str(unit["group"]), [0, 0])
        entry[0] += unit["num"]
        entry[1] += unit["den"]
    keys = sorted(groups)
    total_num, total_den = sum(groups[k][0] for k in keys), sum(groups[k][1] for k in keys)
    rng = random.Random(seed)
    draws: list[float] = []
    undefined = 0
    for _ in range(b):
        num = den = 0
        for _ in keys:
            n, d = groups[keys[rng.randrange(len(keys))]]
            num, den = num + n, den + d
        if den:
            draws.append(num / den)
        else:
            undefined += 1
    draws.sort()
    ci = (None, None)
    if draws:
        ci = (draws[int(math.floor(alpha / 2 * (len(draws) - 1)))], draws[int(math.ceil((1 - alpha / 2) * (len(draws) - 1)))])
    return {"point": rate(total_num, total_den), "ci_low": ci[0], "ci_high": ci[1], "b": b, "seed": seed,
            "groups": len(keys), "undefined_draws": undefined, "numerator": total_num, "denominator": total_den}
