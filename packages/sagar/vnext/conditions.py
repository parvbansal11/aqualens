"""Measured raster conditions, deliberately not motion or calibration estimates."""
from __future__ import annotations
from typing import Any
import numpy as np


class SonarConditionEngine:
    version = "sonar_conditions@v1"
    def assess(self, image: np.ndarray, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        if image.ndim == 3: image = image[..., :3].mean(axis=2)
        a = np.asarray(image, dtype=np.float32)
        if a.size == 0: raise ValueError("empty raster")
        # Scale-independent measures avoid assuming a radiometric calibration.
        p02, p98 = np.percentile(a, [2, 98]); dynamic = float((p98-p02) / max(1.0, a.max()-a.min()))
        black = a <= max(1.0, float(np.percentile(a, 1)))
        row_black = black.mean(axis=1); dropout_rows = row_black >= .92
        dropout_fraction = float(dropout_rows.mean())
        # A single-valued raster (blank or saturated) has zero entropy; binning it would fail.
        if float(a.max()) - float(a.min()) <= 0: entropy = 0.0
        else:
            hist = np.histogram(a, bins=64, range=(float(a.min()), float(a.max()) + 1e-6))[0]; p = hist[hist > 0] / hist.sum()
            entropy = float(-(p * np.log2(p)).sum() / 6.0)
        # A central sustained dark band is only an estimate, and unavailable when absent.
        col_dark = black.mean(axis=0); centre = a.shape[1] // 2; run = 0
        for i in range(max(0, centre-a.shape[1]//8), min(a.shape[1], centre+a.shape[1]//8)):
            if col_dark[i] > .5: run += 1
        nadir_fraction = float(run / a.shape[1]) if run >= max(3, a.shape[1]//100) else 0.0
        flags: list[str] = []
        if dynamic < .12: flags.append("LOW_DYNAMIC_RANGE")
        # A near-black horizontal band can be sensor dropout, acoustic shadow, or a
        # nadir gap; this engine measures the band and does not diagnose its cause.
        if dropout_fraction > .02: flags.append("HORIZONTAL_DARK_BAND")
        if black.mean() > .2: flags.append("HIGH_INVALID_PIXEL_FRACTION")
        if nadir_fraction: flags.append("CENTRAL_DARK_BAND_ESTIMATED")
        quality = max(0., min(1., .45*dynamic + .25*entropy + .30*(1-dropout_fraction-black.mean())))
        grade = "GOOD" if quality >= .7 else "FAIR" if quality >= .45 else "POOR"
        return {"engine_version": self.version, "quality_score": quality, "quality_grade": grade, "quality_flags": flags,
                "dropout_fraction": dropout_fraction, "nadir_fraction": nadir_fraction,
                "usable_fraction": float(max(0., 1-dropout_fraction-black.mean())), "near_black_fraction": float(black.mean()),
                "dynamic_range": dynamic, "entropy": entropy, "resolution": [int(a.shape[1]), int(a.shape[0])],
                "dropout_rows": np.flatnonzero(dropout_rows).astype(int).tolist(),
                "aspect_ratio": float(a.shape[1]/a.shape[0]), "navigation_available": bool((metadata or {}).get("navigation_available")),
                "motion_metadata_available": False, "motion_quality": "UNKNOWN",
                "missing_metadata_flags": ["MOTION_METADATA_UNAVAILABLE"]}

    @staticmethod
    def candidate_overlap(bbox: list[float], image_shape: tuple[int, int], condition: dict[str, Any]) -> dict[str, float]:
        x1, y1, x2, y2 = bbox; width = image_shape[1]
        rows = set(condition.get("dropout_rows", [])); candidate_rows = set(range(max(0, int(y1)), min(image_shape[0], int(np.ceil(y2)))))
        dropout_overlap = len(rows & candidate_rows) / max(1, len(candidate_rows))
        central = abs(((x1+x2)/2) - width/2) <= (condition["nadir_fraction"] * width / 2)
        return {"dropout_overlap": dropout_overlap, "nadir_overlap": 1.0 if central and condition["nadir_fraction"] else 0.0}
