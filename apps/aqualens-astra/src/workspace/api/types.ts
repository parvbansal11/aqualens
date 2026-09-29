/**
 * Wire types for the Aqualens product API.
 * Source of truth: ~/Desktop/aqualens/schemas/aqualens-product.schema.json (generated from
 * packages/sagar/api/product_models.py) and schemas/aqualens-openapi.json. Keep field names identical.
 */

export type EvidenceStatus = "AVAILABLE" | "UNAVAILABLE" | "NOT_VALIDATED" | "NOT_APPLICABLE" | "FAILED";
export type CapabilityStatus = "IMPLEMENTED_AND_VALIDATED" | "IMPLEMENTED_NOT_VALIDATED" | "PROVISIONAL" | "UNAVAILABLE" | "NOT_APPLICABLE";
export type MachineClass = "PIPELINE" | "SHIPWRECK" | "CRAB_POT";
export type ReviewStatus = "UNREVIEWED" | "CONFIRMED" | "REJECTED" | "UNRESOLVED";
export type ReviewDecision = Exclude<ReviewStatus, "UNREVIEWED">;
export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNSET";
/** Backend analyst taxonomy (AnalystClass). The live list comes from /system/provenance.analyst_classes. */
export type AnalystClass = string;
export type NavigationProvenance = "MEASURED" | "DERIVED_FROM_SOURCE" | "SYNTHETIC_DEMO";
export type RecordProvenance = "REAL" | "SYNTHETIC_DEMO";

export interface ApiError {
  error: { code: string; message: string; detail: Record<string, unknown> };
}

export interface Health {
  status: string;
  run_id?: string;
}

export interface Readiness {
  status: "READY" | "NOT_READY";
  services: { api: boolean; database: boolean; storage: boolean; detector: boolean; reporting: boolean; feature_cache?: string };
  detector_loaded: boolean;
  note: string;
}

export interface Capability {
  status: CapabilityStatus;
  availability: EvidenceStatus;
  reason: string;
  mode: string | null;
  classes: string[] | null;
}
export type Capabilities = Record<string, Capability>;

export interface Provenance {
  product: string;
  model_id: string;
  model_sha: string;
  deployment: string;
  scientific_mode: boolean;
  shipwreck_recovery: boolean;
  shipwreck_recovery_invocations: number;
  build_version: string | null;
  association_policy: string;
  working_tree_modified_at_start: boolean | null;
  api_version: string;
  limitations: string[];
  machine_classes: MachineClass[];
  analyst_classes: AnalystClass[];
  authentication: string;
  evaluation: {
    status: EvidenceStatus;
    reason?: string;
    source?: string;
    representation?: string;
    held_out_test_per_class?: Record<string, { precision: number; recall: number; ap50: number; map50_95: number }>;
    shipwreck_status?: string;
    note?: string;
  };
}

export interface Mission {
  mission_id: string;
  name: string;
  operator: string | null;
  created_at: string;
  notes: string | null;
  demo: boolean;
  provenance: RecordProvenance;
  survey_ids: string[];
  upload_ids: string[];
  legacy?: boolean;
}

export interface Upload {
  upload_id: string;
  mission_id: string;
  status: "PENDING" | "INGESTING" | "READY" | "FAILED";
  demo: boolean;
  provenance: RecordProvenance;
  job_id: string;
  sha256: string | null;
  filename: string | null;
  source: string;
  bytes?: number | null;
  created_at?: string | null;
  navigation_provenance?: NavigationProvenance | null;
  warnings?: string[];
}

export interface SurveyFrame {
  frame_id: string;
  width_px: number | null;
  height_px: number | null;
  inference_mode?: string | null;
  raster_duplicate_status?: string | null;
  raster_url?: string;
  demo: boolean;
}

export interface Survey {
  survey_id: string;
  survey_ref: string;
  mission_id: string;
  upload_id: string;
  job_id: string;
  demo: boolean;
  provenance: RecordProvenance;
  status: "PENDING" | "INGESTING" | "READY" | "FAILED";
  membership_provenance: "SINGLETON" | "DECLARED" | "VERIFIED" | "DEMO_FIXTURE";
  frame_ids: string[];
  frames: SurveyFrame[];
  navigation_provenance?: NavigationProvenance | null;
  sensor: string | null;
  acquired_at: string | null;
  name?: string | null;
}

/** One named processing phase as the backend reports it (GET /jobs/{id}). */
export interface JobStep {
  id: string;
  label: string;
  state: "queued" | "running" | "done" | "skipped" | "unavailable" | "failed";
  detail: string | null;
}

export interface Job {
  job_id: string;
  state: string;
  stage?: string;
  /** Ordered list from /jobs/{id}; mission job listings return a keyed map instead. */
  steps?: JobStep[] | Record<string, Omit<JobStep, "id" | "label">>;
  contacts_fused?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  error?: { code: string; message: string } | null;
  warnings?: string[];
  demo?: boolean;
  frames_completed?: number;
  source_frame_count?: number;
}

export interface Evidence {
  status: EvidenceStatus;
  source: string;
  method: string;
  values: Record<string, unknown> | null;
  provenance: string | null;
  reason: string | null;
  timestamp: string;
  artifact_ref: string | null;
  demo: boolean;
}
export type EvidenceKey = "detector" | "local_anomaly" | "persistence" | "raised_relief" | "navigation" | "analyst";

export interface Machine {
  supervised_class: MachineClass;
  /** The frozen detector's own score; shown only in technical detail. */
  raw_detector_score: number;
  model_id: string;
  model_sha: string;
  demo: boolean;
  /** Product presentation confidence (historical SagarDrishti bounded sigmoid). Not a probability. */
  display_confidence?: number | null;
  raw_fused_confidence?: number | null;
  display_confidence_method?: string | null;
}

export interface Analyst {
  classification: AnalystClass;
  status: ReviewStatus;
  priority: Priority;
  reviewed_at: string | null;
}

export interface Look {
  look_id: string;
  survey_ref: string;
  frame_refs: string[];
  detection_ids?: string[];
  basis: string;
  is_independent: boolean;
  provenance: string;
  demo: boolean;
}

export interface Detection {
  detection_id: string;
  survey_ref: string;
  frame_ref: string;
  source_image: string;
  bbox: [number, number, number, number];
  machine_class: MachineClass;
  raw_detector_score: number;
  demo: boolean;
}

export interface ReviewEvent {
  review_id: string;
  contact_id: string;
  actor: string;
  identity_verified: boolean;
  action: string;
  before: Analyst;
  after: Analyst;
  timestamp: string;
  note: string | null;
  demo: boolean;
  provenance: string;
}

export interface Contact {
  contact_id: string;
  mission_id: string;
  survey_refs: string[];
  created_at: string;
  demo: boolean;
  provenance: RecordProvenance;
  association_basis: string;
  look_count: number;
  looks: Look[];
  detections: Detection[];
  machine: Machine | null;
  evidence: Record<EvidenceKey, Evidence>;
  analyst: Analyst;
  system_priority: null;
  history: ReviewEvent[];
}

export interface ContactPage {
  items: Contact[];
  total: number;
  offset: number;
  limit: number;
  demo: boolean;
}

export interface ContactQuery {
  survey_ref?: string;
  machine_class?: MachineClass;
  analyst_class?: AnalystClass;
  status?: ReviewStatus;
  priority?: Priority;
  reviewed?: boolean;
  search?: string;
  sort?: "created" | "reviewed" | "priority";
  limit?: number;
  offset?: number;
}

export interface MapFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { contact_id?: string; provenance: string; demo: boolean; role?: string; survey_ref?: string; frame_ref?: string; verification?: string; timestamp_utc?: string | null };
}

export interface MapResponse {
  availability: "AVAILABLE" | "UNAVAILABLE";
  demo: boolean;
  reason: string | null;
  type: "FeatureCollection";
  features: MapFeature[];
  platform_context: MapFeature[];
}

export interface MissionReport {
  report_id: string;
  generated_at: string;
  demo: boolean;
  label: string;
  mission: Mission;
  uploads: Upload[];
  surveys: Survey[];
  contacts: Contact[];
  map: MapResponse;
  provenance: Provenance;
  processing_runs: Job[];
  limitations: string[];
}

export interface UploadAccepted {
  upload_id: string;
  job_id: string;
  mission_id: string;
  survey_refs: string[];
  state: string;
}
