"""Window-overlap persistence with conservative Wilson scoring."""
from __future__ import annotations

from math import sqrt
from typing import Any


def wilson_lower_bound(successes: int, opportunities: int, z: float = 1.6448536269514722) -> float:
    """One-sided lower bound at 90% confidence, never a raw support ratio."""
    if opportunities <= 0 or successes < 0 or successes > opportunities:
        raise ValueError("invalid persistence counts")
    if opportunities == 0:
        return 0.0
    p = successes / opportunities
    denominator = 1 + z * z / opportunities
    centre = p + z * z / (2 * opportunities)
    radius = z * sqrt((p * (1 - p) + z * z / (4 * opportunities)) / opportunities)
    return max(0.0, min(1.0, (centre - radius) / denominator))


def _intersection(one: tuple[float, float, float, float], two: tuple[float, float, float, float]) -> float:
    ax, ay, aw, ah = one
    bx, by, bw, bh = two
    return max(0.0, min(ax + aw, bx + bw) - max(ax, bx)) * max(0.0, min(ay + ah, by + bh) - max(ay, by))


def persistence_from_window_overlap(
    detection_bbox_frame_px: tuple[float, float, float, float],
    candidate_tile_ids: list[str],
    observed_tile_ids: list[str],
    source_tile_bounds: dict[str, tuple[int, int, int, int]],
    observed_boxes_frame_px: list[tuple[float, float, float, float]] | None = None,
) -> dict[str, Any]:
    """Compute persistence only from descendant windows covering the source-frame box.

    It deliberately keeps frame-pixel association separate from PICS when the nadir is unknown.
    The provenance remains WINDOW_OVERLAP and no ping/range coordinate is invented.
    """
    covered = [tile_id for tile_id in candidate_tile_ids if _intersection(detection_bbox_frame_px, source_tile_bounds[tile_id]) > 0]
    if len(covered) <= 1:
        return {
            "applicable": False,
            "reason": "SINGLE_WINDOW_COVERAGE",
            "score": None,
            "mode": "WINDOW_OVERLAP",
            "n_obs": len(set(observed_tile_ids) & set(covered)),
            "n_opportunities": len(covered),
            "support_ratio": None,
            "scatter_px": None,
            "scatter_m": None,
            "track_id": None,
        }
    observed = len(set(observed_tile_ids) & set(covered))
    scatter_px: float | None = None
    if observed_boxes_frame_px:
        centres = [(box[0] + box[2] / 2, box[1] + box[3] / 2) for box in observed_boxes_frame_px]
        if len(centres) == 1:
            scatter_px = 0.0
        elif len(centres) > 1:
            values = [(x - sum(point[0] for point in centres) / len(centres)) ** 2 + (y - sum(point[1] for point in centres) / len(centres)) ** 2 for x, y in centres]
            scatter_px = sqrt(sum(values) / len(values))
    return {
        "applicable": True,
        "reason": None,
        "score": wilson_lower_bound(observed, len(covered)),
        "mode": "WINDOW_OVERLAP",
        "n_obs": observed,
        "n_opportunities": len(covered),
        "support_ratio": observed / len(covered),
        "scatter_px": scatter_px,
        "scatter_m": None,
        "track_id": None,
    }
