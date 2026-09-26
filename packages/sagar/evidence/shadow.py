"""Range-matched acoustic shadow evidence; unavailable without recoverable nadir."""
from __future__ import annotations

from typing import Any

import numpy as np


def _unavailable(reason: str) -> dict[str, Any]:
    return {
        "applicable": False,
        "reason": reason,
        "score": None,
        "contrast_z": None,
        "continuity": None,
        "ordering_ok": None,
        "shadow_len_px": None,
        "implied_height_m": None,
        "height_assumptions": [],
    }


def range_matched_shadow(
    image: np.ndarray,
    bbox_xywh: tuple[float, float, float, float],
    nadir_offset_px: float | None,
    range_scale_m_per_px: float | None,
) -> dict[str, Any]:
    """Measure a dark shadow band in the +u_range direction.

    A range scale is not needed for the score, but nadir is mandatory because it determines the
    sign of +u_range. Metric height is intentionally omitted unless all required inputs exist.
    """
    if nadir_offset_px is None:
        return _unavailable("NADIR_NOT_RECOVERABLE")
    if image.ndim != 2:
        raise ValueError("shadow input must be a grayscale image")
    x, y, width, height = bbox_xywh
    x0, x1 = max(0, int(x)), min(image.shape[1], int(np.ceil(x + width)))
    y0, y1 = max(0, int(y)), min(image.shape[0], int(np.ceil(y + height)))
    if x1 <= x0 or y1 <= y0:
        return _unavailable("INVALID_CANDIDATE_GEOMETRY")
    centre = (y0 + y1) / 2
    if abs(centre - nadir_offset_px) < max(2.0, height / 2):
        return _unavailable("CANDIDATE_IN_NADIR_BAND")
    direction = 1 if centre > nadir_offset_px else -1
    shadow_length = int(min(3 * max(1, y1 - y0), max(1, image.shape[0] / 4)))
    start = y1 if direction > 0 else y0 - shadow_length
    end = y1 + shadow_length if direction > 0 else y0
    if start < 0 or end > image.shape[0]:
        return _unavailable("SHADOW_TRUNCATED_AT_RANGE_EDGE")
    band = image[start:end, x0:x1].astype(np.float32)
    # Matched background samples the same range rows beyond the candidate's along-track span.
    background_columns = np.r_[max(0, x0 - (x1 - x0)):x0, x1:min(image.shape[1], x1 + (x1 - x0))]
    if len(background_columns) == 0:
        return _unavailable("RANGE_MATCHED_BACKGROUND_UNAVAILABLE")
    background = image[start:end, background_columns].astype(np.float32)
    mean, std = float(background.mean()), float(background.std())
    if std < 1e-6:
        return _unavailable("RANGE_MATCHED_BACKGROUND_LOW_VARIANCE")
    contrast_z = (mean - float(band.mean())) / std
    continuity = float(np.mean(band.mean(axis=1) < mean - 1.5 * std))
    highlight_slice = image[max(0, y0 - height):y0, x0:x1] if direction > 0 else image[y1:min(image.shape[0], y1 + height), x0:x1]
    ordering_ok = bool(highlight_slice.size and float(highlight_slice.mean()) > mean)
    score = float(np.clip(0.5 * np.tanh(max(0.0, contrast_z) / 2) + 0.35 * continuity + 0.15 * ordering_ok, 0, 1))
    return {
        "applicable": True,
        "reason": None,
        "score": score,
        "contrast_z": contrast_z,
        "continuity": continuity,
        "ordering_ok": ordering_ok,
        "shadow_len_px": shadow_length,
        "implied_height_m": None,
        "height_assumptions": [],
        "range_unit": "METRIC_RANGE" if range_scale_m_per_px is not None else "PIXEL_RANGE",
    }
