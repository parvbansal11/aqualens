"""Frozen API-contract domain records and their invariant validators."""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrEnum(str, Enum):
    pass


class SpatialReferenceLevel(StrEnum):
    L0_PIXEL_ONLY = "L0_PIXEL_ONLY"
    L1_TILE_RELATIVE = "L1_TILE_RELATIVE"
    L2_TRACK_RELATIVE = "L2_TRACK_RELATIVE"
    L3_SURVEYED = "L3_SURVEYED"


class Provenance(StrEnum):
    MODEL_DERIVED = "MODEL_DERIVED"
    HEURISTIC_DERIVED = "HEURISTIC_DERIVED"
    OPERATOR_PROVIDED = "OPERATOR_PROVIDED"
    DEMO_METADATA = "DEMO_METADATA"
    NONE = "NONE"


class DetectionKind(StrEnum):
    KNOWN = "KNOWN"
    UNKNOWN = "UNKNOWN"


class DetectionSource(StrEnum):
    KNOWN_DETECTOR = "KNOWN_DETECTOR"
    KNOWN_SEGMENTER = "KNOWN_SEGMENTER"
    OPEN_WORLD = "OPEN_WORLD"


class UnifiedClass(StrEnum):
    PIPELINE = "PIPELINE"
    WRECK_OR_STRUCTURAL_DEBRIS = "WRECK_OR_STRUCTURAL_DEBRIS"
    DERELICT_FISHING_GEAR = "DERELICT_FISHING_GEAR"
    ENGINEERING_STRUCTURE = "ENGINEERING_STRUCTURE"
    UNKNOWN_ANOMALY_CANDIDATE = "UNKNOWN_ANOMALY_CANDIDATE"


class LabelCertainty(StrEnum):
    CERTAIN = "CERTAIN"
    UNCERTAIN = "UNCERTAIN"


class ReviewVerdict(StrEnum):
    CONFIRMED = "CONFIRMED"
    REJECTED = "REJECTED"
    RELABELLED = "RELABELLED"
    UNCERTAIN = "UNCERTAIN"


class ChangeStatus(StrEnum):
    NEW = "NEW"
    UNCHANGED = "UNCHANGED"
    NOT_DETECTED = "NOT_DETECTED"
    REMOVED = "REMOVED"
    NOT_SURVEYED = "NOT_SURVEYED"
    UNKNOWN = "UNKNOWN"


class PersistenceMode(StrEnum):
    WINDOW_OVERLAP = "WINDOW_OVERLAP"
    SEQUENTIAL_PING = "SEQUENTIAL_PING"


class Channel(StrEnum):
    PORT = "PORT"
    STARBOARD = "STARBOARD"
    DUAL = "DUAL"
    UNKNOWN = "UNKNOWN"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=False)


class Mission(ContractModel):
    mission_id: str
    name: str
    operator: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    survey_ids: list[str] = Field(default_factory=list)
    notes: str | None = None


class CapabilityGates(ContractModel):
    nav_available: bool | None = None
    ping_order_recoverable: bool | None = None
    nadir_recoverable: bool | None = None
    range_scale_known: bool | None = None


class Geometry(ContractModel):
    along_track_axis: str = "COLS"
    along_sign: int = 1
    across_origin: str = "NADIR_CENTRE"
    channel: Channel = Channel.UNKNOWN
    range_geometry: str = "UNKNOWN"
    nadir_offset_px: float | None = None
    nadir_confidence: float | None = None
    range_scale_m_per_px: float | None = None
    ping_index_start: float | None = None
    ping_stride: float | None = None
    altitude_m: float | None = None
    level: SpatialReferenceLevel = SpatialReferenceLevel.L0_PIXEL_ONLY
    level_reason: str


class ImageQuality(ContractModel):
    speckle_index: float | None = None
    dropout_fraction: float | None = None
    attitude_banding_score: float | None = None
    usable: bool = True
    reason: str | None = None


class Survey(ContractModel):
    survey_id: str
    mission_id: str
    name: str
    dataset_id: str
    sensor: str | None = None
    frequency_khz: float | None = None
    acquired_at: datetime | None = None
    is_demo: bool = False
    demo_banner: str | None = None
    spatial_reference_level: SpatialReferenceLevel = SpatialReferenceLevel.L0_PIXEL_ONLY
    level_reason: str
    frame_count: int = 0
    tile_count: int = 0
    coverage_polygon: dict[str, Any] | None = None
    coverage_provenance: Provenance = Provenance.NONE
    track: dict[str, Any] | None = None
    capability_gates: CapabilityGates = Field(default_factory=CapabilityGates)
    latest_run_id: str | None = None

    @model_validator(mode="after")
    def demo_has_banner(self) -> "Survey":
        if self.is_demo and not self.demo_banner:
            raise ValueError("demo survey requires demo_banner")
        return self


class SourceProvenance(ContractModel):
    dataset_id: str
    source_filename: str
    licence: str
    sha256: str | None = None
    source_url: str | None = None
    acquisition_timestamp: datetime | None = None


class SonarFrame(ContractModel):
    frame_id: str
    survey_id: str
    index: int
    width_px: int
    height_px: int
    sensor: str | None = None
    frequency_khz: float | None = None
    geometry: Geometry
    quality: ImageQuality | None = None
    layers: dict[str, str] = Field(default_factory=dict)
    provenance: SourceProvenance


class Tile(ContractModel):
    tile_id: str
    source_frame_id: str
    split: str
    x_origin_px: int
    y_origin_px: int
    width_px: int
    height_px: int
    source_width_px: int
    source_height_px: int
    padded_right_px: int = 0
    padded_bottom_px: int = 0
    pics_transform: dict[str, Any]
    annotation_ids: list[str] = Field(default_factory=list)


class EvidenceChannel(ContractModel):
    applicable: bool
    reason: str | None = None
    score: float | None = None

    @model_validator(mode="after")
    def unavailable_is_explicit(self) -> "EvidenceChannel":
        if not self.applicable and (self.reason is None or self.score is not None):
            raise ValueError("unavailable evidence requires reason and null score")
        return self


class DetectionGeometry(ContractModel):
    bbox_px: tuple[float, float, float, float]
    bbox_frame_px: tuple[float, float, float, float]
    mask_rle: str | None = None
    pics: dict[str, Any]


class Dimensions(ContractModel):
    length_px: float | None = None
    width_px: float | None = None
    length_m: float | None = None
    width_m: float | None = None
    area_m2: float | None = None
    estimator: str = "NONE"
    reason: str | None = None

    @model_validator(mode="after")
    def missing_metric_length_has_reason(self) -> "Dimensions":
        if self.length_m is None and not self.reason:
            raise ValueError("null dimensions.length_m requires a reason")
        return self


class GeoFix(ContractModel):
    lat: float | None = None
    lon: float | None = None
    position_uncertainty_m: float | None = None
    heading_deg: float | None = None
    provenance: Provenance = Provenance.NONE
    nav_source: str | None = None
    spatial_reference_level: SpatialReferenceLevel = SpatialReferenceLevel.L0_PIXEL_ONLY
    reason: str | None = None

    @model_validator(mode="after")
    def coordinates_have_provenance(self) -> "GeoFix":
        if self.lat is not None and self.provenance is Provenance.NONE:
            raise ValueError("geolocation coordinates require provenance")
        return self


class Fusion(ContractModel):
    final_confidence: float | None = None
    contributions: dict[str, float] = Field(default_factory=dict)
    intercept: float | None = None
    calibration_id: str | None = None
    fusion_model_id: str | None = None
    reason: str | None = None
    feature_list: set[str] = Field(default_factory=set, exclude=True)

    @model_validator(mode="after")
    def registered_features_only(self) -> "Fusion":
        if self.feature_list and not set(self.contributions).issubset(self.feature_list):
            raise ValueError("fusion contributions must exist in registered feature list")
        return self


class Detection(ContractModel):
    detection_id: str
    run_id: str | None = None
    survey_id: str
    frame_id: str
    tile_id: str | None = None
    kind: DetectionKind
    source: DetectionSource
    category: UnifiedClass
    class_confidence: float | None = None
    label_certainty: LabelCertainty | None = None
    anomaly_score: float | None = None
    geometry: DetectionGeometry
    # Channel payloads extend EvidenceChannel with channel-specific measurements. Keep the
    # extension open while retaining the unavailable-channel invariant below.
    evidence: dict[str, Any] = Field(default_factory=dict)
    fusion: Fusion | None = None
    dimensions: Dimensions | None = None
    geo: GeoFix | None = None
    model: dict[str, Any] | None = None
    review: dict[str, Any] | None = None
    change_status: ChangeStatus | None = None
    priority: dict[str, Any] | None = None
    provenance: dict[str, Provenance] = Field(default_factory=dict)
    parent_survey_is_demo: bool = False

    @model_validator(mode="after")
    def detection_contract(self) -> "Detection":
        if self.kind is DetectionKind.UNKNOWN:
            if self.category is not UnifiedClass.UNKNOWN_ANOMALY_CANDIDATE or self.class_confidence is not None:
                raise ValueError("UNKNOWN requires UNKNOWN_ANOMALY_CANDIDATE and null class_confidence")
        if self.kind is DetectionKind.KNOWN and self.category is UnifiedClass.UNKNOWN_ANOMALY_CANDIDATE:
            raise ValueError("KNOWN detection cannot use unknown category")
        if self.geo and self.geo.provenance is Provenance.DEMO_METADATA and not self.parent_survey_is_demo:
            raise ValueError("DEMO_METADATA geolocation requires a demo survey")
        for name, channel in self.evidence.items():
            if isinstance(channel, dict) and not channel.get("applicable", True):
                if not channel.get("reason") or channel.get("score") is not None:
                    raise ValueError(f"unavailable evidence channel {name} requires reason and null score")
        return self


Anomaly = Detection


class Review(ContractModel):
    review_id: str
    detection_id: str
    verdict: ReviewVerdict
    corrected_class: UnifiedClass | None = None
    corrected_bbox_px: tuple[float, float, float, float] | None = None
    notes: str | None = None
    reviewer: str
    created_at: datetime = Field(default_factory=utc_now)
    model_version_id_at_prediction: str | None = None
    confidence_at_prediction: float | None = None
    training_eligible: bool = False
    training_eligible_reason: str | None = None
    included_in_snapshots: list[str] = Field(default_factory=list)
    provenance: Provenance = Provenance.OPERATOR_PROVIDED


class ModelVersion(ContractModel):
    model_version_id: str
    model_id: str
    version: str
    parent_model_version_id: str | None = None
    architecture: str
    init_from: str
    framework: str
    device_trained: str
    weights_sha256: str
    size_mb: float
    snapshot_id: str
    split_id: str
    train_run_id: str
    classes: list[UnifiedClass]
    metrics_ref: str
    calibration_id: str | None = None
    review_examples_included: int = 0
    is_active: bool = False
    registered_at: datetime = Field(default_factory=utc_now)


class Benchmark(ContractModel):
    run_id: str
    git_sha: str | None = None
    generated_at: datetime = Field(default_factory=utc_now)
    device: str
    split_id: str
    split_assertions: dict[str, str]
    detection: dict[str, Any] = Field(default_factory=dict)
    open_set: dict[str, Any] = Field(default_factory=dict)
    segmentation: dict[str, Any] = Field(default_factory=dict)
    operational: dict[str, Any] = Field(default_factory=dict)
    ablations: list[dict[str, Any]] = Field(default_factory=list)


class SurveyChange(ContractModel):
    change_id: str
    comparison_id: str
    baseline_survey_id: str
    new_survey_id: str
    status: ChangeStatus
    baseline_detection_id: str | None = None
    new_detection_id: str | None = None
    distance_m: float | None = None
    match_score: float | None = None
    inside_new_coverage: bool
    baseline_confirmed_by_operator: bool = False
    provenance: Provenance = Provenance.HEURISTIC_DERIVED

    @model_validator(mode="after")
    def removed_requires_coverage(self) -> "SurveyChange":
        if self.status is ChangeStatus.REMOVED and not self.inside_new_coverage:
            raise ValueError("REMOVED requires inside_new_coverage")
        return self


class RecoveryPriority(ContractModel):
    detection_id: str
    score: float
    rank: int
    config_version: str
    components: dict[str, dict[str, float]]
    provenance: Provenance = Provenance.HEURISTIC_DERIVED
    disclaimer: str

    @model_validator(mode="after")
    def components_sum_to_score(self) -> "RecoveryPriority":
        total = sum(component.get("contribution", 0.0) for component in self.components.values())
        if abs(total - self.score) > 1e-8:
            raise ValueError("priority component contributions must sum to score")
        return self


class RunManifest(ContractModel):
    run_id: str
    snapshot_id: str
    split_id: str
    created_at: datetime = Field(default_factory=utc_now)
    git_sha: str | None = None
    device: str | None = None
    split_assertions: dict[str, str] = Field(default_factory=dict)


class DatasetSnapshot(ContractModel):
    snapshot_id: str
    generated_at: datetime = Field(default_factory=utc_now)
    source_datasets: list[dict[str, Any]]
    canonical_class_config_version: int
    split_seed: int
    frame_counts: dict[str, int]
    tile_counts: dict[str, int]
    split_counts: dict[str, int]
    class_distribution: dict[str, int]
    preprocessing_version: str
    tiling: dict[str, Any]
    git_commit: str | None = None
    split_id: str | None = None
    split_assertions: dict[str, str] = Field(default_factory=dict)
