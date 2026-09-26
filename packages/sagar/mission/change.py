"""Survey comparison that refuses false metric precision below L2."""
from __future__ import annotations

import uuid
from collections import Counter
from typing import Any

from sagar.core.models import ChangeStatus, SpatialReferenceLevel, SurveyChange


class ComparisonRefused(RuntimeError):
    pass


def compare_detections(
    baseline_survey_id: str,
    new_survey_id: str,
    baseline_level: SpatialReferenceLevel,
    new_level: SpatialReferenceLevel,
    baseline: list[dict[str, Any]],
    current: list[dict[str, Any]],
    confirmed_only: bool = False,
    coverage_by_baseline_id: dict[str, bool] | None = None,
) -> tuple[str, list[SurveyChange]]:
    if baseline_level not in {SpatialReferenceLevel.L2_TRACK_RELATIVE, SpatialReferenceLevel.L3_SURVEYED} or new_level not in {SpatialReferenceLevel.L2_TRACK_RELATIVE, SpatialReferenceLevel.L3_SURVEYED}:
        raise ComparisonRefused("Both surveys must reach L2_TRACK_RELATIVE to compare.")
    comparison_id = f"cmp_{uuid.uuid4().hex[:12]}"
    candidates = [item for item in baseline if not confirmed_only or item.get("review", {}).get("latest_verdict") == "CONFIRMED"]
    # Metric PICS matching is intentionally delegated until surveys have actual L2 PICS.
    # This branch is only reached with L2+ input and expects callers to pre-associate records.
    unmatched_new = list(current)
    changes: list[SurveyChange] = []
    for old in candidates:
        matched = next((item for item in unmatched_new if item.get("matched_baseline_id") == old["detection_id"]), None)
        if matched:
            unmatched_new.remove(matched)
            status = ChangeStatus.UNCHANGED
            changes.append(SurveyChange(change_id=f"chg_{uuid.uuid4().hex[:12]}", comparison_id=comparison_id, baseline_survey_id=baseline_survey_id, new_survey_id=new_survey_id, status=status, baseline_detection_id=old["detection_id"], new_detection_id=matched["detection_id"], inside_new_coverage=True))
        else:
            covered = (coverage_by_baseline_id or {}).get(old["detection_id"])
            # A detector absence is never removal.  Coverage only establishes that
            # the location was reacquired; a human/validated matching decision is
            # required before a caller may represent a removal.
            status = ChangeStatus.NOT_DETECTED if covered is True else ChangeStatus.NOT_SURVEYED
            changes.append(SurveyChange(change_id=f"chg_{uuid.uuid4().hex[:12]}", comparison_id=comparison_id, baseline_survey_id=baseline_survey_id, new_survey_id=new_survey_id, status=status, baseline_detection_id=old["detection_id"], inside_new_coverage=covered is True, baseline_confirmed_by_operator=old.get("review", {}).get("latest_verdict") == "CONFIRMED"))
    for item in unmatched_new:
        changes.append(SurveyChange(change_id=f"chg_{uuid.uuid4().hex[:12]}", comparison_id=comparison_id, baseline_survey_id=baseline_survey_id, new_survey_id=new_survey_id, status=ChangeStatus.NEW, new_detection_id=item["detection_id"], inside_new_coverage=True))
    return comparison_id, changes


def change_summary(changes: list[SurveyChange]) -> dict[str, int]:
    counts = Counter(change.status.value for change in changes)
    return {status.value: counts[status.value] for status in ChangeStatus}
