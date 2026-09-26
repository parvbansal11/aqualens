"""Auditable, geometry-aware evidence channels."""

from .persistence import persistence_from_window_overlap, wilson_lower_bound
from .shadow import range_matched_shadow

__all__ = ["persistence_from_window_overlap", "range_matched_shadow", "wilson_lower_bound"]
