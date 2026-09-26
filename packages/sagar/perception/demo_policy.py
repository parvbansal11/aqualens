"""Presentation-only policy isolated from production inference records."""
from __future__ import annotations


def shipwreck_demo_presentation(raw_class: str, raw_confidence: float | None, anomaly_score: float | None = None) -> dict[str, object]:
    """INTERNAL DEMO ONLY - NOT PRODUCTION CALIBRATION.

    Raw inference is deliberately never changed.  A presentation value exists
    only for a real class-1 prediction or an existing anomaly candidate.
    """
    raw_signal = raw_confidence if raw_class == "SHIPWRECK" and raw_confidence is not None else anomaly_score
    if raw_signal is None:
        return {"display_class": raw_class, "display_confidence": raw_confidence, "classification_source": "MODEL", "production_qualified": raw_class != "SHIPWRECK"}
    if raw_class == "SHIPWRECK" or anomaly_score is not None:
        return {"display_class": "SHIPWRECK", "display_confidence": min(0.94, max(0.72, raw_signal * 0.85 + 0.15)), "classification_source": "DEMO_HEURISTIC", "production_qualified": False}
    return {"display_class": raw_class, "display_confidence": raw_confidence, "classification_source": "MODEL", "production_qualified": True}


def spatial_consensus_presentation(evidence_count: int, tile_diversity: int, mean_cluster_iou: float) -> dict[str, object]:
    """INTERNAL HACKATHON DEMO ONLY - NOT PRODUCTION CALIBRATION, NOT measured
    detector confidence.

    Presentation only for a SHIPWRECK candidate consolidated from several weak
    (<0.12) tiled proposals that spatially agree (see
    FinalDetector._recover_weak_shipwreck_cluster). The returned confidence
    reflects how much independent proposals across tiles corroborate the same
    region -- not what the model itself scored. raw_confidence is untouched
    elsewhere and always the true maximum YOLO score inside the cluster.
    """
    support_term = min(1.0, evidence_count / 10.0)
    diversity_term = min(1.0, tile_diversity / 4.0)
    concentration_term = max(0.0, min(1.0, mean_cluster_iou))
    agreement = 0.4 * support_term + 0.3 * diversity_term + 0.3 * concentration_term
    floor, ceiling = 0.55, 0.85
    display_confidence = min(ceiling, max(floor, floor + agreement * (ceiling - floor)))
    return {
        "display_class": "SHIPWRECK",
        "display_confidence": round(display_confidence, 4),
        "classification_source": "DEMO_HEURISTIC",
        "production_qualified": False,
        "display_confidence_source": "SPATIAL_CONSENSUS_HEURISTIC",
    }
