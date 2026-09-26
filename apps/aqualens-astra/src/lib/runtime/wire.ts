/* Shapes returned by the real backend. Field names mirror the API exactly;
 * nothing is renamed or coalesced on the way in. See packages/sagar/api/app.py
 * and packages/sagar/perception/runtime.py. */

export type Screen =
  | "landing"
  | "entry"
  | "upload"
  | "processing"
  | "results"
  | "map"
  | "workspace"
  | "review"
  | "mission"
  | "decision"
  | "change"
  | "memory"
  | "report"
  | "lab";

/** What this browser currently knows about the analysis service. */
export type ConnectionState = {
  status: "CHECKING" | "ONLINE" | "DEGRADED" | "OFFLINE";
  health: RuntimeHealth | null;
  /** Why the service is degraded or unreachable, in plain language. */
  message: string | null;
  checkedAt: string | null;
};

export type RoleId = "field" | "analyst" | "supervisor" | "decision";

export type Verdict = "CONFIRMED" | "REJECTED" | "RELABELLED" | "UNCERTAIN";

export type ReviewEvent = {
  review_id: string;
  verdict: string;
  corrected_class: string | null;
  corrected_bbox_px: number[] | null;
  notes: string | null;
  reviewer: string;
  created_at: string;
  append_only: boolean;
};

export type RuntimeFinding = {
  detection_id: string;
  survey_id: string;
  source_frame_id: string;
  source_image_path: string;
  tile_id: string | null;
  raw_class_id: number;
  raw_class: string;
  raw_confidence: number | null;
  display_class: string;
  display_confidence: number | null;
  classification_source: string;
  production_qualified: boolean;
  anomaly_score: number | null;
  /** [x1, y1, x2, y2] in source pixels. */
  bbox_px: number[];
  /** [x1, y1, x2, y2] as fractions of the source frame. */
  bbox_normalized: number[];
  /** [width, height] of the source frame in pixels. */
  pixel_dimensions: number[];
  geo: { lat: number | null; lon: number | null };
  review_state: string | null;
  review_history: ReviewEvent[];
  model_id: string;
  model_sha256: string;
  dataset_snapshot_id: string;
  run_id: string;
  /** Provenance of the runtime tiling fix (packages/sagar/perception/runtime.py). Optional so
   * existing literals built before tiling stay valid without an update. */
  inference_mode?: "TILED" | "FULL_FRAME";
  tile_size?: number | null;
  tile_overlap?: number | null;
  /** Inherited from the source frame's navigation.csv row, when the upload carried one
   * (sagar.perception.navigation). Mirrors `geo` exactly; never a substituted value. */
  latitude?: number | null;
  longitude?: number | null;
  heading_deg?: number | null;
  timestamp_utc?: string | null;
  navigation_status?: "AVAILABLE" | "UNAVAILABLE";
  open_set?: OpenSetEvidence;
  pipeline_verification?: PipelineVerification;
  sonar_condition?: SonarCondition;
  sonar_evidence?: {
    dropout_overlap?: number | null;
    nadir_overlap?: number | null;
  };
  frame_index?: number;
  ping_start?: number | null;
  ping_end?: number | null;
  sequential_observation_supported?: boolean;
};

export type FrameNavigation = {
  latitude: number | null;
  longitude: number | null;
  heading_deg: number | null;
  timestamp_utc: string | null;
  navigation_status: "AVAILABLE" | "UNAVAILABLE";
};

export type RuntimeFrame = {
  frame_id: string;
  source_path: string;
  width_px: number;
  height_px: number;
  inference_mode?: "TILED" | "FULL_FRAME";
  tile_count?: number;
  navigation?: FrameNavigation;
  sonar_condition?: SonarCondition;
};

/** Measured raster conditions. Never a calibration or a motion estimate. */
export type SonarCondition = {
  engine_version?: string;
  quality_score?: number | null;
  quality_grade?: "GOOD" | "FAIR" | "POOR" | string;
  quality_flags?: string[];
  dropout_fraction?: number | null;
  nadir_fraction?: number | null;
  usable_fraction?: number | null;
  dynamic_range?: number | null;
  entropy?: number | null;
  navigation_available?: boolean;
  motion_quality?: string;
  missing_metadata_flags?: string[];
};

export type MissionMetadata = {
  mission_id: string | null;
  survey_name: string | null;
  platform: string | null;
  operator: string | null;
  sensor: string | null;
  frequency_khz: number | null;
  mission_type: string | null;
  notes: string | null;
};

export type RuntimeSurvey = {
  survey_id: string;
  name: string;
  created_at: string;
  frames: RuntimeFrame[];
  findings: RuntimeFinding[];
  navigation_status?: "AVAILABLE" | "UNAVAILABLE";
  mission?: MissionMetadata | null;
  contacts?: RuntimeContact[];
  model_registry?: Record<string, ComponentHealth>;
  contact_fusion_policy?: string;
  sequential_observation_contract?: boolean;
};

/** VNEXT primary object; findings remain raw detector observations. */
export type RuntimeContact = {
  contact_id: string;
  survey_id?: string;
  source_detection_ids: string[];
  source_frame_ids?: string[];
  best_observation_id: string | null;
  resolved_class?: string | null;
  candidate_classes?: string[];
  observation_count?: number;
  distinct_frame_observation_count?: number;
  window_overlap_duplicate_count?: number;
  max_raw_confidence?: number | null;
  mean_raw_confidence?: number | null;
  confidence?: number | null;
  normalized_confidence?: number | null;
  raw_fused_confidence?: number | null;
  evidence_score: number | null;
  evidence_strength?: number | null;
  anomaly_score?: number | null;
  anomaly_threshold?: number | null;
  anomaly_threshold_provenance?: string | null;
  anomaly_feature_source?: string | null;
  anomaly_memory_version?: string | null;
  is_open_set_candidate?: boolean;
  evidence_breakdown?: {
    score_type?: string;
    policy_version?: string;
    missing_components?: string[];
    components?: Record<
      string,
      {
        value: number;
        weight: number;
        normalized_weight: number;
        contribution: number;
      }
    >;
  };
  persistence_evidence_type?: string;
  persistence_score?: number | null;
  quality_score?: number | null;
  quality_flags?: string[];
  latitude?: number | null;
  longitude?: number | null;
  navigation_status?: string;
  localization_uncertainty_status?: string;
  priority_score?: number | null;
  priority_band?: string;
  priority_components?: Record<string, number>;
  recommended_action?: string;
  disposition?: string;
  natural_clutter?: {
    status?: string;
    mode?: string;
    experimental?: boolean;
    score?: number | null;
  };
  pipeline_verification?: PipelineVerification;
  open_set?: OpenSetEvidence;
  reviews?: {
    history?: ReviewEvent[];
    latest_verdict?: string | null;
    review_count?: number;
  };
  provenance?: { detector_model_sha?: string | null; runtime_version?: string };
};

/** Algorithmic, advisory evidence only. These states never relabel, remove, or
 * reduce the immutable raw detector observation. */
export type PipelineVerification = {
  status?: string;
  hard_return_status?: "PRESENT" | "WEAK" | "NOT_OBSERVED" | "UNAVAILABLE";
  shadow_status?: "UNAVAILABLE" | "NOT_ASSESSED";
  reasons?: string[];
  missing_inputs?: string[];
  evidence_strength?: number | null;
  candidate_bright_fraction?: number | null;
  candidate_dark_fraction?: number | null;
  local_contrast?: number | null;
  elongation?: number | null;
};

export type OpenSetEvidence = {
  anomaly_score?: number | null;
  threshold?: number | null;
  threshold_source?: string | null;
  feature_source?: string | null;
  memory_version?: string | null;
  is_open_set_candidate?: boolean;
  status?: "AVAILABLE" | "NOT_CONFIGURED" | "FAILED";
  missing_inputs?: string[];
};

export type JobState =
  | "QUEUED"
  | "PREPROCESSING"
  | "INFERENCE"
  | "POSTPROCESSING"
  | "COMPLETED"
  | "FAILED";

/** A phase state the backend actually observed. Never an animation cue. */
export type JobStepState =
  "queued" | "running" | "done" | "skipped" | "unavailable" | "failed";

export type JobStep = {
  id: string;
  label: string;
  state: JobStepState;
  detail: string | null;
};

/**
 * The processing view renders this and nothing else. There is deliberately no
 * percentage field: `frames_completed` over `source_frame_count` is the only
 * ratio, and both are counted by the backend after the work has happened.
 */
export type RuntimeJob = {
  job_id: string;
  survey_id: string;
  state: JobState;
  stage: string;
  phase?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  files_parsed: number;
  images_processed: number;
  tiles_processed: number;
  detections_generated: number;
  upload?: {
    filename: string | null;
    bytes: number;
    kind: "RASTER" | "BUNDLE";
    decoded: boolean;
    bundle_entries: number | null;
    raster_count: number;
  };
  source_frame_count?: number;
  frames_completed?: number;
  metadata?: {
    navigation: "AVAILABLE" | "UNAVAILABLE";
    mission: "AVAILABLE" | "UNAVAILABLE";
    sequential_observation_contract: boolean;
  };
  detector?: {
    availability: string;
    loaded: boolean;
    device: string;
    model_sha256: string | null;
  };
  open_set?: ComponentHealth;
  contacts_fused?: number | null;
  report_ready?: boolean;
  steps?: JobStep[];
  error?: { code: string; message: string; phase?: string | null } | null;
};

/** One optional component's real runtime state, as the registry reports it. */
export type ComponentHealth = {
  availability: "AVAILABLE" | "UNAVAILABLE" | "NOT_CONFIGURED" | "FAILED";
  available?: boolean;
  role?: string;
  status?: string;
  mode?: string;
  automatic_veto_permitted?: boolean;
  method?: string;
  feature_source?: string;
  memory_version?: string;
  threshold?: number | null;
  threshold_source?: string | null;
  reference_count?: number | null;
};

export type RuntimeHealth = {
  status: "ok" | "degraded";
  runtime_available: boolean;
  device: string;
  model_loaded: boolean;
  model_sha256: string | null;
  class_names: Record<string, string>;
  optional_models: Record<string, ComponentHealth>;
  api_version?: string;
  started_at?: string;
  uptime_seconds?: number;
  runtime_surveys_retained?: number;
  frozen_evidence_run_id?: string;
};

export type RuntimeSurveySummary = {
  survey_id: string;
  name: string;
  created_at: string;
  frame_count: number;
  finding_count: number;
  contact_count: number;
  reviewed_count: number;
  navigation_status: "AVAILABLE" | "UNAVAILABLE";
};

export type RuntimeSurveyIndex = {
  items: RuntimeSurveySummary[];
  total: number;
};

/** Capability gates for a resurvey comparison, and the reasons it is refused. */
export type ChangeReadiness = {
  supported: boolean;
  status: "COMPARISON_REFUSED" | "COMPARISON_SUPPORTED";
  new_survey: ChangeSurveyGates;
  baseline_survey: ChangeSurveyGates;
  blockers: { gate: string; reason: string }[];
  semantics: { state: string; meaning: string }[];
};

export type ChangeSurveyGates = {
  survey_id: string | null;
  name?: string;
  navigation_status: string;
  spatial_reference_level: string | null;
  coverage_polygon: boolean;
  positioned_observations: number;
  observation_count: number;
  contact_count?: number;
};

export type MemoryStats = {
  append_only: boolean;
  online_learning: boolean;
  event_count: number;
  verdicts: Record<string, number>;
  queues: {
    hard_negative: number;
    confirmed_positive: number;
    relabelled: number;
    uncertain: number;
  };
  reviewers: Record<string, number>;
  surveys_retained: number;
  surveys_with_review: number;
  observations: number;
  reviewed_observations: number;
  export_targets: string[];
  note: string;
};

export type MemoryEvent = ReviewEvent & {
  survey_id: string;
  survey_name: string;
  detection_id: string;
  contact_id: string | null;
  raw_class: string;
  raw_confidence: number | null;
  model_sha256: string;
  training_memory_queue: string;
};

export type MemoryEvents = {
  items: MemoryEvent[];
  total: number;
  append_only: boolean;
  online_learning: boolean;
};

export type ModelCard = {
  model: string;
  checkpoint_sha256: string | null;
  shipwreck_status: string;
  s1_provenance: string;
  open_set?: {
    availability: string;
    method?: string;
    feature_source?: string;
    memory_version?: string;
    threshold?: number;
    threshold_source?: string;
    reference_count?: number;
  };
  metrics: {
    experiment?: string;
    dataset_snapshot_id?: string;
    classes?: Record<string, string>;
    unknown_is_supervised?: boolean;
    preflight?: Record<
      string,
      { instances?: Record<string, number>; problem_count?: number }
    >;
    protocol?: Record<string, unknown>;
    winner?: {
      model?: string;
      best_checkpoint_sha256?: string;
      heldout_test_overall?: Record<string, number>;
      heldout_test_per_class?: Record<string, Record<string, number>>;
    };
    latency?: {
      n_images?: number;
      mean_ms?: number;
      median_ms?: number;
      p95_ms?: number;
      approx_images_per_second?: number;
    };
    device?: Record<string, string | number>;
  };
};
