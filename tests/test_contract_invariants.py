from pydantic import ValidationError
import pytest

from sagar.core.models import (
    ChangeStatus, Channel, Detection, DetectionGeometry, DetectionKind, DetectionSource,
    Dimensions, EvidenceChannel, Fusion, GeoFix, Provenance, SurveyChange, UnifiedClass,
)


def geometry():
    return DetectionGeometry(bbox_px=(0, 0, 1, 1), bbox_frame_px=(0, 0, 1, 1), pics={})


def test_unknown_cannot_have_known_confidence():
    with pytest.raises(ValidationError):
        Detection(detection_id="d", survey_id="s", frame_id="f", kind=DetectionKind.UNKNOWN,
                  source=DetectionSource.OPEN_WORLD, category=UnifiedClass.UNKNOWN_ANOMALY_CANDIDATE,
                  class_confidence=0.1, geometry=geometry())


def test_known_cannot_use_unknown_category():
    with pytest.raises(ValidationError):
        Detection(detection_id="d", survey_id="s", frame_id="f", kind=DetectionKind.KNOWN,
                  source=DetectionSource.KNOWN_DETECTOR, category=UnifiedClass.UNKNOWN_ANOMALY_CANDIDATE,
                  geometry=geometry())


def test_unavailable_evidence_requires_reason_and_null_score():
    with pytest.raises(ValidationError):
        EvidenceChannel(applicable=False, reason=None, score=0.1)


def test_geo_requires_provenance():
    with pytest.raises(ValidationError):
        GeoFix(lat=1.0, lon=2.0)


def test_missing_metric_dimension_requires_reason():
    with pytest.raises(ValidationError):
        Dimensions(length_m=None)


def test_fusion_features_must_be_registered():
    with pytest.raises(ValidationError):
        Fusion(contributions={"unregistered": 1.0}, feature_list={"registered"})


def test_removed_outside_coverage_is_rejected():
    with pytest.raises(ValidationError):
        SurveyChange(change_id="c", comparison_id="cmp", baseline_survey_id="a", new_survey_id="b",
                     status=ChangeStatus.REMOVED, inside_new_coverage=False)
