"""Contact evidence views and deterministic, non-calibrated confidence fusion."""
from __future__ import annotations
from dataclasses import dataclass
from itertools import combinations
from math import exp, isfinite, prod
from typing import Any
@dataclass(frozen=True)
class EvidenceFusionPolicy:
    version:str="evidence_fusion@v1"
    weights:dict[str,float]=None  # type: ignore[assignment]
    def __post_init__(self):
        if self.weights is None: object.__setattr__(self,"weights",{"detector":.30,"persistence":.25,"physics":.18,"quality":.15,"anomaly":.07,"artificiality":.05})


@dataclass(frozen=True)
class ContactConfidencePolicy:
    """Weights are evidence influence, not probability calibration parameters.

    Each available channel contributes a non-negative support value.  Fusion is
    a weighted noisy-OR, then a bounded pairwise agreement term.  Consequently
    adding or increasing supporting evidence cannot lower the result.  Values
    are system confidence, not statistically calibrated probabilities.
    """
    version: str = "CONTACT_EVIDENCE_FUSION_V1"
    weights: dict[str, float] = None  # type: ignore[assignment]
    agreement_weight: float = .18

    def __post_init__(self):
        if self.weights is None:
            object.__setattr__(self, "weights", {
                "raw_detector": .65,
                "temporal_persistence": .70,
                "acoustic_shadow": .60,
                "physics": .35,
                "sonar_condition": .20,
                "open_set_anomaly": .30,
                "artificiality": .15,
                # Navigation fixes locate a frame; they are not object evidence.
                "navigation_consistency": .15,
            })


@dataclass(frozen=True)
class DemoConfidenceNormalizationPolicy:
    """Fixed demo-display mapping for the Epitome v2 runtime distribution.

    ``reference_center`` is the median raw fused confidence from the Epitome v2
    regression run (0.3139777305538386). ``steepness`` is fixed globally and
    applies to every Contact; neither parameter varies by class, image, or
    Contact. This is presentation normalization, never probability calibration.
    """
    version: str = "DEMO_BOUNDED_SIGMOID_V1"
    lower: float = .70
    upper: float = .90
    reference_center: float = .3139777305538386
    steepness: float = 28.0


def normalize_demo_confidence(
    raw_fused_confidence: float,
    policy: DemoConfidenceNormalizationPolicy = DemoConfidenceNormalizationPolicy(),
) -> float:
    """Strictly monotonic bounded sigmoid for finite raw fused scores."""
    try:
        raw = float(raw_fused_confidence)
    except (TypeError, ValueError) as exc:
        raise ValueError("raw_fused_confidence must be a finite number in [0, 1]") from exc
    if not isfinite(raw) or not 0.0 <= raw <= 1.0:
        raise ValueError("raw_fused_confidence must be a finite number in [0, 1]")
    sigmoid = 1.0 / (1.0 + exp(-policy.steepness * (raw - policy.reference_center)))
    return policy.lower + (policy.upper - policy.lower) * sigmoid


def _bounded(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return None


def _persistence_support(contact: dict[str, Any]) -> float | None:
    value = _bounded(contact.get("persistence_score"))
    if value is None:
        return None
    # 0.15 is the explicit single/window-overlap baseline, not temporal support.
    return max(0.0, (value - .15) / .85)


def _acoustic_support(contact: dict[str, Any]) -> float | None:
    verification = contact.get("pipeline_verification") or {}
    if verification.get("status") not in {"SUPPORTED", "WEAK_SUPPORT"}:
        return None
    return _bounded(verification.get("evidence_strength"))


def _open_set_support(contact: dict[str, Any]) -> float | None:
    score = _bounded(contact.get("anomaly_score"))
    threshold = _bounded(contact.get("anomaly_threshold"))
    if score is None or threshold is None:
        return None
    # This normalizes distance beyond its own frozen threshold. It deliberately
    # is not represented as a detector-class probability.
    return max(0.0, (score - threshold) / max(1e-12, 1.0 - threshold))


def confidence_components(contact: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Return raw and normalized support values without changing raw evidence."""
    physics = contact.get("physics_consistency")
    if (contact.get("pipeline_verification") or {}).get("status") == "INSUFFICIENT_EVIDENCE":
        physics = None
    raw = {
        "raw_detector": contact.get("max_raw_confidence"),
        "temporal_persistence": contact.get("persistence_score"),
        "acoustic_shadow": (contact.get("pipeline_verification") or {}).get("evidence_strength"),
        "physics": physics,
        "sonar_condition": contact.get("quality_score"),
        "open_set_anomaly": contact.get("anomaly_score"),
        "artificiality": contact.get("artificiality_score"),
        "navigation_consistency": contact.get("navigation_consistency"),
    }
    normalized = {
        "raw_detector": _bounded(raw["raw_detector"]),
        "temporal_persistence": _persistence_support(contact),
        "acoustic_shadow": _acoustic_support(contact),
        "physics": _bounded(physics),
        "sonar_condition": _bounded(raw["sonar_condition"]),
        "open_set_anomaly": _open_set_support(contact),
        "artificiality": _bounded(raw["artificiality"]),
        "navigation_consistency": _bounded(raw["navigation_consistency"]),
    }
    return {
        name: {
            "raw_value": raw[name],
            "normalized_support": normalized[name],
            "available": normalized[name] is not None,
            "role": "ADVISORY_OPEN_SET_EVIDENCE" if name == "open_set_anomaly" else "SUPPORTING_EVIDENCE",
        }
        for name in raw
    }


def fuse_contact_confidence(contact: dict[str, Any], policy: ContactConfidencePolicy = ContactConfidencePolicy()) -> dict[str, Any]:
    """Fuse Contact evidence into a bounded, deterministic system confidence.

    Missing channels do not participate. The pairwise agreement term only
    activates for independently available positive supports and is non-negative.
    """
    components = confidence_components(contact)
    active = []
    for name, component in components.items():
        support = component["normalized_support"]
        weight = policy.weights[name]
        component["weight"] = weight
        component["weighted_support"] = None if support is None else weight * support
        if support is not None and support > 0.0:
            active.append((name, float(support), weight))
    base = 1.0 - prod(1.0 - weight * support for _, support, weight in active) if active else 0.0
    pairs = [left[1] * right[1] for left, right in combinations(active, 2)]
    agreement_signal = sum(pairs) / len(pairs) if pairs else 0.0
    agreement_contribution = (1.0 - base) * policy.agreement_weight * agreement_signal
    raw_fused_confidence = max(0.0, min(1.0, base + agreement_contribution))
    normalization = DemoConfidenceNormalizationPolicy()
    normalized_confidence = normalize_demo_confidence(raw_fused_confidence, normalization)
    return {
        # ``confidence`` remains the UI-facing Contact value; the original
        # evidence-fusion result is retained exactly under its explicit name.
        "confidence": normalized_confidence,
        "raw_fused_confidence": raw_fused_confidence,
        "normalized_confidence": normalized_confidence,
        "raw_detector_confidence": contact.get("max_raw_confidence"),
        "confidence_components": components,
        "confidence_method": policy.version,
        "confidence_normalization": normalization.version,
        "confidence_normalization_range": [normalization.lower, normalization.upper],
        "confidence_normalization_reference_center": normalization.reference_center,
        "confidence_normalization_steepness": normalization.steepness,
        "confidence_normalization_note": "DEMO_NORMALIZATION_NOT_CALIBRATED_PROBABILITY",
        "confidence_formula": "WEIGHTED_NOISY_OR_WITH_PAIRWISE_AGREEMENT",
        "agreement_signal": agreement_signal,
        "agreement_contribution": agreement_contribution,
        "missing_components": sorted(name for name, value in components.items() if not value["available"]),
    }


def score_contact(contact:dict[str,Any], policy:EvidenceFusionPolicy=EvidenceFusionPolicy()) -> dict[str,Any]:
    # A pipeline verifier can be insufficient because range-side geometry is
    # unavailable. That is missing acoustic evidence, not negative evidence. Do
    # not permit an incidental physics scalar to penalize that Contact.
    physics = contact.get("physics_consistency")
    if (contact.get("pipeline_verification") or {}).get("status") == "INSUFFICIENT_EVIDENCE":
        physics = None
    raw={"detector":contact.get("max_raw_confidence"),"persistence":contact.get("persistence_score"),"physics":physics,"quality":contact.get("quality_score"),"anomaly":contact.get("anomaly_score"),"artificiality":contact.get("artificiality_score")}
    values={k:float(v) for k,v in raw.items() if v is not None}; missing=sorted(set(raw)-set(values)); total=sum(policy.weights[k] for k in values)
    components={k:{"value":v,"weight":policy.weights[k],"normalized_weight":policy.weights[k]/total,"contribution":v*policy.weights[k]/total} for k,v in values.items()}
    return {"evidence_score":sum(x["contribution"] for x in components.values()) if components else None,"score_type":"UNVALIDATED_EVIDENCE_FUSION","policy_version":policy.version,"components":components,"missing_components":missing}
