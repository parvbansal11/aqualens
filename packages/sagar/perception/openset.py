"""Compatibility exports for the canonical VNEXT open-set implementation."""
from __future__ import annotations

from dataclasses import dataclass
from sagar.vnext.openset import OpenSetMemoryBank, OpenSetUnavailable

@dataclass(frozen=True)
class OpenSetProposal:
    bbox_xywh: tuple[float, float, float, float]
    anomaly_score: float

__all__ = ["OpenSetMemoryBank", "OpenSetUnavailable", "OpenSetProposal"]
