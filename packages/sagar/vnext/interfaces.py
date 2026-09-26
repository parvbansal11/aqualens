"""Stable optional-model interfaces.  Null implementations never invent evidence."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol


class CandidateGenerator(Protocol):
    name: str
    def available(self) -> bool: ...
    def generate(self, image: Any, context: dict[str, Any]) -> list[dict[str, Any]]: ...


class NaturalClutterScorer(Protocol):
    name: str
    def available(self) -> bool: ...
    def score(self, crop: Any, context: dict[str, Any]) -> dict[str, Any]: ...


class MaskRefiner(Protocol):
    name: str
    def available(self) -> bool: ...
    def refine(self, image: Any, bbox: list[float]) -> dict[str, Any]: ...


@dataclass
class NullNaturalClutterScorer:
    name: str = "natural_clutter:null"
    model_path: Path | None = None
    def available(self) -> bool: return False
    def score(self, crop: Any, context: dict[str, Any]) -> dict[str, Any]:
        return {
            "artificiality_score": None,
            "clutter_model_version": "natural_clutter_v1",
            "status": "REJECTED_FOR_AUTOMATIC_SUPPRESSION",
            "mode": "ADVISORY_ONLY",
            "experimental": True,
            "reason": "MODEL_NOT_LOADED_ADVISORY_EXPERIMENT_ONLY",
        }


@dataclass
class UnavailableRFDETR:
    name: str = "rfdetr:unavailable"
    def available(self) -> bool: return False
    def generate(self, image: Any, context: dict[str, Any]) -> list[dict[str, Any]]:
        return []


@dataclass
class NullMaskRefiner:
    name: str = "mask_refiner:null"
    def available(self) -> bool: return False
    def refine(self, image: Any, bbox: list[float]) -> dict[str, Any]:
        return {"mask": None, "reason": "MODEL_UNAVAILABLE"}


class ModelRegistry:
    """Availability only; optional artifacts are never loaded or substituted implicitly."""
    def __init__(self, detector_available: bool, clutter: NaturalClutterScorer | None = None,
                 rfdetr: CandidateGenerator | None = None, refiner: MaskRefiner | None = None,
                 open_set: dict[str, Any] | None = None) -> None:
        self.detector_available, self.clutter = detector_available, clutter or NullNaturalClutterScorer()
        self.rfdetr, self.refiner = rfdetr or UnavailableRFDETR(), refiner or NullMaskRefiner()
        self.open_set = open_set or {"availability": "NOT_CONFIGURED", "available": False, "role": "ADVISORY_OPEN_SET_EVIDENCE"}
    def health(self) -> dict[str, dict[str, Any]]:
        def state(value: bool, configured: bool = True) -> str:
            return "AVAILABLE" if value else "UNAVAILABLE" if configured else "NOT_CONFIGURED"
        return {"yolo11s": {"availability": state(self.detector_available), "available": self.detector_available, "role": "KNOWN_CLASS_CANDIDATE_GENERATOR"},
                "rfdetr": {"availability": state(self.rfdetr.available(), False), "available": self.rfdetr.available(), "role": "OPTIONAL_CANDIDATE_GENERATOR"},
                "natural_clutter": {
                    "availability": state(self.clutter.available(), False), "available": self.clutter.available(),
                    "role": "EXPERIMENTAL_ADVISORY_EVIDENCE_ONLY",
                    "status": "REJECTED_FOR_AUTOMATIC_SUPPRESSION", "mode": "ADVISORY_ONLY",
                    "automatic_veto_permitted": False,
                },
                "mask_refiner": {"availability": state(self.refiner.available(), False), "available": self.refiner.available(), "role": "OPTIONAL_REFINER"},
                "open_set": self.open_set}
