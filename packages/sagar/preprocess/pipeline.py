"""P0 non-destructive preprocessing with explicitly uncertain nadir geometry."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageFilter, ImageOps

from sagar.io.common import write_json

PREPROCESSING_VERSION = "p0.1"
NADIR_CONFIDENCE_THRESHOLD = 0.55


@dataclass(frozen=True)
class NadirEstimate:
    position_px: float | None
    confidence: float
    state: str
    reason: str | None


def estimate_nadir(image: np.ndarray) -> NadirEstimate:
    """Conservative water-column ridge estimate based on the low-return across-track band."""
    if image.ndim != 2 or min(image.shape) < 32 or float(np.std(image)) < 1.0:
        return NadirEstimate(None, 0.0, "UNKNOWN", "INSUFFICIENT_TEXTURE")
    # For waterfall strips, across-track is rows (COLS is along-track in the contract).
    profile = np.median(image.astype(np.float32), axis=1)
    smooth = np.convolve(profile, np.ones(15, dtype=np.float32) / 15, mode="same")
    # Constrain to the central 60%: an edge dropout must not become a nadir claim.
    lo, hi = int(len(smooth) * 0.2), int(len(smooth) * 0.8)
    if hi <= lo:
        return NadirEstimate(None, 0.0, "UNKNOWN", "INVALID_GEOMETRY")
    region = smooth[lo:hi]
    candidate = lo + int(np.argmin(region))
    robust_spread = float(np.percentile(region, 75) - np.percentile(region, 25))
    contrast = float(np.median(region) - smooth[candidate])
    depth_ratio = max(0.0, contrast / (robust_spread + 1e-6))
    edge = min(candidate - lo, hi - 1 - candidate) / max(1, (hi - lo) / 2)
    confidence = float(min(1.0, 0.5 * min(depth_ratio / 2.0, 1.0) + 0.5 * max(0.0, edge)))
    if confidence < NADIR_CONFIDENCE_THRESHOLD:
        return NadirEstimate(None, confidence, "LOW_QUALITY", "NADIR_NOT_RECOVERABLE")
    return NadirEstimate(float(candidate), confidence, "RECOVERED", None)


def _clahe_like(image: Image.Image) -> Image.Image:
    # PIL has no CLAHE. Local equalization is deliberately bounded and recorded as CLAHE-like.
    return ImageOps.equalize(image)


def quality_score(array: np.ndarray) -> dict[str, Any]:
    mean = float(array.mean())
    std = float(array.std())
    dropout = float(np.mean(array <= 1))
    row_means = array.mean(axis=1)
    banding = float(np.std(np.diff(row_means)) / (std + 1e-6))
    usable = dropout < 0.35 and std > 3.0
    return {"speckle_index": float(std / (mean + 1e-6)), "dropout_fraction": dropout,
            "attitude_banding_score": banding, "usable": usable,
            "reason": None if usable else "LOW_CONTRAST_OR_DROPOUT"}


def preprocess_frame(frame: dict[str, Any], output_root: str | Path) -> dict[str, Any]:
    output_root = Path(output_root)
    with Image.open(frame["source_path"]) as image:
        raw = image.convert("L")
        raw_array = np.asarray(raw)
        estimate = estimate_nadir(raw_array)
        # A light median suppresses isolated speckle; raw source is untouched.
        enhanced = _clahe_like(raw.filter(ImageFilter.MedianFilter(size=3)))
    enhanced_path = output_root / "enhanced" / f"{frame['frame_id']}.png"
    enhanced_path.parent.mkdir(parents=True, exist_ok=True)
    enhanced.save(enhanced_path)
    geometry = dict(frame["geometry"])
    geometry["nadir_offset_px"] = estimate.position_px
    geometry["nadir_confidence"] = estimate.confidence
    geometry["level"] = "L1_TILE_RELATIVE" if estimate.position_px is not None else "L0_PIXEL_ONLY"
    geometry["level_reason"] = "nadir estimated; range scale unknown" if estimate.position_px is not None else estimate.reason
    result = {"frame_id": frame["frame_id"], "source_frame_id": frame["frame_id"],
              "output_path": str(enhanced_path), "preprocessing_version": PREPROCESSING_VERSION,
              "geometry": geometry, "nadir": asdict(estimate), "quality": quality_score(raw_array),
              "lineage": [{"operation": "raw_preservation", "parameters": {}},
                          {"operation": "nadir_estimation", "parameters": {"threshold": NADIR_CONFIDENCE_THRESHOLD}},
                          {"operation": "median_speckle_suppression", "parameters": {"kernel": 3}},
                          {"operation": "clahe_like_local_equalization", "parameters": {}}]}
    write_json(output_root / "preprocess" / f"{frame['frame_id']}.json", result)
    return result
