"""Product contracts. Analyst semantics never modify immutable machine evidence."""
from enum import Enum
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sagar.core.models import Mission

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class EvidenceStatus(str, Enum):
    AVAILABLE = 'AVAILABLE'
    UNAVAILABLE = 'UNAVAILABLE'
    NOT_VALIDATED = 'NOT_VALIDATED'
    NOT_APPLICABLE = 'NOT_APPLICABLE'
    FAILED = 'FAILED'

class CapabilityStatus(str, Enum):
    IMPLEMENTED_AND_VALIDATED = 'IMPLEMENTED_AND_VALIDATED'
    IMPLEMENTED_NOT_VALIDATED = 'IMPLEMENTED_NOT_VALIDATED'
    PROVISIONAL = 'PROVISIONAL'
    UNAVAILABLE = 'UNAVAILABLE'
    NOT_APPLICABLE = 'NOT_APPLICABLE'

class AnalystClass(str, Enum):
    FISHING_GEAR = 'FISHING_GEAR'
    ROPE_LINE = 'ROPE_LINE'
    NET_LIKE_DEBRIS = 'NET_LIKE_DEBRIS'
    PLASTIC_DEBRIS = 'PLASTIC_DEBRIS'
    METALLIC_DEBRIS = 'METALLIC_DEBRIS'
    CONTAINER_DRUM = 'CONTAINER_DRUM'
    TYRE_RUBBER = 'TYRE_RUBBER'
    CABLE_PIPELINE_RELATED = 'CABLE_PIPELINE_RELATED'
    STRUCTURAL_DEBRIS = 'STRUCTURAL_DEBRIS'
    NATURAL_FEATURE = 'NATURAL_FEATURE'
    OTHER = 'OTHER'
    UNRESOLVED = 'UNRESOLVED'

class Priority(str, Enum):
    CRITICAL = 'CRITICAL'
    HIGH = 'HIGH'
    MEDIUM = 'MEDIUM'
    LOW = 'LOW'
    UNSET = 'UNSET'

class MissionInput(Strict):
    name: str = Field(min_length=1, max_length=160, pattern=r'\S')
    operator: str | None = Field(default=None, max_length=160)
    notes: str | None = Field(default=None, max_length=4000)

class ProductMission(Mission):
    demo: bool = False
    provenance: Literal['REAL', 'SYNTHETIC_DEMO'] = 'REAL'
    upload_ids: list[str] = Field(default_factory=list)

class Evidence(Strict):
    status: EvidenceStatus
    source: str
    method: str
    values: dict[str, Any] | None = None
    provenance: str | None = None
    reason: str | None = None
    timestamp: str
    artifact_ref: str | None = None
    demo: bool = False

    @model_validator(mode='after')
    def missing_is_not_numeric_evidence(self):
        if self.status != EvidenceStatus.AVAILABLE and self.values is not None:
            raise ValueError('Unavailable/unvalidated evidence cannot carry measured values')
        if self.status != EvidenceStatus.AVAILABLE and not self.reason:
            raise ValueError('Missing evidence requires a reason')
        return self

class Machine(Strict):
    supervised_class: Literal['PIPELINE', 'SHIPWRECK', 'CRAB_POT']
    raw_detector_score: float = Field(ge=0, le=1)
    model_id: str
    model_sha: str
    demo: bool = False

class Analyst(Strict):
    classification: AnalystClass = AnalystClass.UNRESOLVED
    status: Literal['UNREVIEWED', 'CONFIRMED', 'REJECTED', 'UNRESOLVED'] = 'UNREVIEWED'
    priority: Priority = Priority.UNSET
    reviewed_at: str | None = None

class Contact(Strict):
    contact_id: str
    mission_id: str
    survey_refs: list[str]
    created_at: str
    demo: bool = False
    provenance: Literal['REAL', 'SYNTHETIC_DEMO'] = 'REAL'
    association_basis: str
    look_count: int = Field(ge=1)
    looks: list[dict[str, Any]]
    detections: list[dict[str, Any]]
    machine: Machine | None
    evidence: dict[str, Evidence]
    analyst: Analyst = Field(default_factory=Analyst)
    system_priority: None = None
    history: list[dict[str, Any]] = Field(default_factory=list)

class Mutation(Strict):
    actor: str = Field(min_length=1, max_length=160, pattern=r'\S')
    note: str | None = Field(default=None, max_length=4000)

class ReviewInput(Mutation):
    status: Literal['CONFIRMED', 'REJECTED', 'UNRESOLVED']

class ClassificationInput(Mutation):
    classification: AnalystClass

class PriorityInput(Mutation):
    priority: Priority

class NoteInput(Mutation):
    note: str = Field(min_length=1, max_length=4000, pattern=r'\S')

class Capability(Strict):
    status: CapabilityStatus
    availability: EvidenceStatus
    reason: str
    mode: str | None = None
    classes: list[str] | None = None

class ReviewEvent(Strict):
    review_id: str
    contact_id: str
    actor: str
    identity_verified: bool
    action: str
    before: Analyst
    after: Analyst
    timestamp: str
    note: str | None
    demo: bool
    provenance: str

class MapResponse(Strict):
    availability: Literal['AVAILABLE', 'UNAVAILABLE']
    demo: bool
    reason: str | None
    type: Literal['FeatureCollection']
    features: list[dict[str, Any]]
    platform_context: list[dict[str, Any]] = Field(default_factory=list)

class UploadRecord(Strict):
    upload_id: str
    mission_id: str
    status: Literal['PENDING', 'INGESTING', 'READY', 'FAILED']
    demo: bool
    provenance: Literal['REAL', 'SYNTHETIC_DEMO']
    job_id: str
    sha256: str | None
    filename: str | None
    source: str
    bytes: int | None = None
    runtime_ref: str | None = None
    created_at: str | None = None
    navigation_provenance: Literal['MEASURED', 'DERIVED_FROM_SOURCE', 'SYNTHETIC_DEMO'] | None = None
    warnings: list[str] = Field(default_factory=list)

class SurveyView(Strict):
    """Projection of B's strict Survey membership, not the legacy Upload identifier."""
    survey_id: str
    survey_ref: str
    mission_id: str
    upload_id: str
    job_id: str
    demo: bool
    provenance: Literal['REAL', 'SYNTHETIC_DEMO']
    status: Literal['PENDING', 'INGESTING', 'READY', 'FAILED']
    membership_provenance: Literal['SINGLETON', 'DECLARED', 'VERIFIED', 'DEMO_FIXTURE']
    frame_ids: list[str]
    frames: list[dict[str, Any]]
    navigation_provenance: Literal['MEASURED', 'DERIVED_FROM_SOURCE', 'SYNTHETIC_DEMO'] | None = None
    runtime_ref: str | None = None
    sensor: str | None = None
    acquired_at: str | None = None
    name: str | None = None
    geometry_signature: dict[str, Any] | None = None
    ping_relationship: dict[str, Any] | None = None

class MissionReport(Strict):
    report_id: str
    generated_at: str
    demo: bool
    label: str
    mission: ProductMission
    uploads: list[UploadRecord]
    surveys: list[SurveyView]
    contacts: list[Contact]
    map: MapResponse
    provenance: dict[str, Any]
    processing_runs: list[dict[str, Any]]
    limitations: list[str]
