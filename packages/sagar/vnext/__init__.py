"""Additive, non-training intelligence primitives for the VNEXT runtime."""

from .contacts import ContactFusionPolicy, fuse_contacts
from .conditions import SonarConditionEngine
from .evidence import ContactConfidencePolicy, DemoConfidenceNormalizationPolicy, EvidenceFusionPolicy, fuse_contact_confidence, normalize_demo_confidence, score_contact
from .interfaces import ModelRegistry

__all__ = ["ContactConfidencePolicy", "ContactFusionPolicy", "DemoConfidenceNormalizationPolicy", "EvidenceFusionPolicy", "ModelRegistry", "SonarConditionEngine", "fuse_contact_confidence", "fuse_contacts", "normalize_demo_confidence", "score_contact"]
