"""Recovery priority calculated solely from the versioned configuration."""
from __future__ import annotations

from math import log1p
from pathlib import Path
from typing import Any

import yaml

from sagar.core.models import RecoveryPriority

DISCLAIMER = "Transparent decision support. Not a learned ecological-risk model."


def calculate_priority(
    detection_id: str,
    category: str,
    final_confidence: float | None,
    persistence_score: float | None,
    shadow_score: float | None,
    anomaly_score: float | None,
    area_m2: float | None,
    change_status: str | None,
    config_path: str | Path = "configs/priority_weights.yaml",
    rank: int = 0,
) -> RecoveryPriority | None:
    """Return None when a required metric footprint is unavailable.

    Pixel area is not substituted for m². Doing so would make the configured footprint
    normaliser appear comparable across surveys when it is not.
    """
    if final_confidence is None or area_m2 is None:
        return None
    with Path(config_path).open() as handle:
        config = yaml.safe_load(handle)
    weights: dict[str, float] = config["weights"]
    footprint = min(1.0, log1p(max(0.0, area_m2)) / log1p(config["normalisers"]["footprint"]["cap_m2"]))
    persistence = persistence_score if persistence_score is not None else config["normalisers"]["persistence"]["value_when_not_applicable"]
    anomaly = max(value for value in (shadow_score, anomaly_score) if value is not None) if any(value is not None for value in (shadow_score, anomaly_score)) else 0.0
    class_weights = config["class_weight"]
    class_weight = class_weights.get(category, class_weights.get("UNKNOWN_ARTIFICIAL_ANOMALY_CANDIDATE", 0.0))
    newness = config["newness"].get(change_status or "null", config["newness"]["null"])
    values = {
        "confidence": float(final_confidence), "persistence": float(persistence), "anomaly_evidence": float(anomaly),
        "footprint": float(footprint), "class_weight": float(class_weight), "newness": float(newness),
    }
    components = {
        name: {"weight": float(weights[name]), "value": value, "contribution": float(weights[name]) * value}
        for name, value in values.items()
    }
    return RecoveryPriority(
        detection_id=detection_id,
        score=sum(part["contribution"] for part in components.values()),
        rank=rank,
        config_version=f"priority_weights@v{config['version']}",
        components=components,
        disclaimer=DISCLAIMER,
    )
