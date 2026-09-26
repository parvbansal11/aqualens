"""Small auditable logistic fusion; fitting is explicitly validation-only."""
from __future__ import annotations

from dataclasses import dataclass
from math import exp
from typing import Iterable

import numpy as np

FUSION_FEATURES = (
    "calibrated_det_logit",
    "persistence_wilson",
    "log_opportunities",
    "shadow_score",
    "shadow_applicable",
    "context_z",
    "clutter_density",
    "anomaly_score",
)


@dataclass(frozen=True)
class FusionModel:
    model_id: str
    calibration_id: str
    intercept: float
    coefficients: dict[str, float]
    fitted_split: str

    def __post_init__(self) -> None:
        if self.fitted_split != "val":
            raise ValueError("fusion may only be fitted on validation data")
        if set(self.coefficients) != set(FUSION_FEATURES):
            raise ValueError("fusion model must register exactly the eight frozen features")

    def predict(self, features: dict[str, float]) -> dict[str, object]:
        if set(features) != set(FUSION_FEATURES):
            raise ValueError("fusion feature payload does not match the registered feature list")
        contributions = {key: self.coefficients[key] * float(features[key]) for key in FUSION_FEATURES}
        logit = self.intercept + sum(contributions.values())
        confidence = 1 / (1 + exp(-max(-40, min(40, logit))))
        return {
            "final_confidence": confidence,
            "contributions": contributions,
            "intercept": self.intercept,
            "calibration_id": self.calibration_id,
            "fusion_model_id": self.model_id,
        }


def fit_logistic_fusion(
    rows: Iterable[dict[str, float]], labels: Iterable[int], split: str, model_id: str, calibration_id: str,
    l2: float = 1.0, iterations: int = 250, learning_rate: float = 0.05,
) -> FusionModel:
    """Fit the frozen eight-feature model without a scikit-learn dependency."""
    if split != "val":
        raise ValueError("fusion fitting is validation-only; training/test data are prohibited")
    samples = list(rows)
    target = np.asarray(list(labels), dtype=np.float64)
    if not samples or len(samples) != len(target) or not set(target).issubset({0, 1}):
        raise ValueError("fusion requires aligned binary validation examples")
    x = np.asarray([[row[name] for name in FUSION_FEATURES] for row in samples], dtype=np.float64)
    means = x.mean(axis=0)
    scales = x.std(axis=0)
    scales[scales == 0] = 1
    normalized = (x - means) / scales
    design = np.c_[np.ones(len(normalized)), normalized]
    weights = np.zeros(design.shape[1], dtype=np.float64)
    for _ in range(iterations):
        logits = np.clip(design @ weights, -40, 40)
        prediction = 1 / (1 + np.exp(-logits))
        gradient = design.T @ (prediction - target) / len(target)
        gradient[1:] += l2 * weights[1:] / len(target)
        weights -= learning_rate * gradient
    # Store raw-space coefficients so every API prediction remains self-contained.
    raw_coefficients = weights[1:] / scales
    raw_intercept = weights[0] - float(np.sum(weights[1:] * means / scales))
    return FusionModel(model_id, calibration_id, float(raw_intercept), dict(zip(FUSION_FEATURES, map(float, raw_coefficients))), split)
