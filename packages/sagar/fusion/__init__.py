"""Validation-only calibration and transparent linear evidence fusion."""

from .calibration import FUSION_FEATURES, FusionModel, fit_logistic_fusion

__all__ = ["FUSION_FEATURES", "FusionModel", "fit_logistic_fusion"]
