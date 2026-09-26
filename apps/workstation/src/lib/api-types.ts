export type SpatialReferenceLevel =
  | "L0_PIXEL_ONLY"
  | "L1_TILE_RELATIVE"
  | "L2_TRACK_RELATIVE"
  | "L3_SURVEYED";

export type Provenance =
  | "MODEL_DERIVED"
  | "HEURISTIC_DERIVED"
  | "OPERATOR_PROVIDED"
  | "DEMO_METADATA"
  | "NONE";

export type DetectionKind = "KNOWN" | "UNKNOWN";
export type DetectionSource = "KNOWN_DETECTOR" | "KNOWN_SEGMENTER" | "OPEN_WORLD";
export type UnifiedClass =
  | "PIPELINE"
  | "WRECK_OR_STRUCTURAL_DEBRIS"
  | "DERELICT_FISHING_GEAR"
  | "ENGINEERING_STRUCTURE"
  | "UNKNOWN_ANOMALY_CANDIDATE";
export type ReviewVerdict = "CONFIRMED" | "REJECTED" | "RELABELLED" | "UNCERTAIN";
export type ChangeStatus = "NEW" | "UNCHANGED" | "REMOVED" | "NOT_SURVEYED";
export type PersistenceMode = "WINDOW_OVERLAP" | "SEQUENTIAL_PING";
export type Channel = "PORT" | "STARBOARD" | "DUAL" | "UNKNOWN";
export type LayerMode = "raw" | "enhanced" | "detections" | "change";

export interface Mission {
  mission_id: string;
  name: string;
  operator: string | null;
  created_at: string;
  survey_ids: string[];
  notes: string | null;
}

export interface Survey {
  survey_id: string;
  mission_id: string;
  name: string;
  dataset_id: string;
  sensor: string | null;
  frequency_khz: number | null;
  acquired_at: string | null;
  is_demo: boolean;
  demo_banner: string | null;
  spatial_reference_level: SpatialReferenceLevel;
  level_reason: string;
  frame_count: number;
  tile_count: number;
  coverage_polygon: { type: "Polygon"; coordinates: number[][][] } | null;
  coverage_provenance: Provenance;
  track: {
    type: "LineString";
    coordinates: number[][];
    provenance: string;
  } | null;
  capability_gates: {
    nav_available: boolean;
    ping_order_recoverable: boolean;
    nadir_recoverable: boolean;
    range_scale_known: boolean;
  };
  latest_run_id: string | null;
}

export interface SonarFrame {
  frame_id: string;
  survey_id: string;
  index: number;
  width_px: number;
  height_px: number;
  sensor: string;
  frequency_khz: number;
  geometry: {
    along_track_axis: "COLS" | "ROWS";
    along_sign: number;
    across_origin: string;
    channel: Channel;
    range_geometry: string;
    nadir_offset_px: number | null;
    nadir_confidence: number | null;
    range_scale_m_per_px: number | null;
    altitude_m: number | null;
    level: SpatialReferenceLevel;
    level_reason: string;
  };
  quality: {
    speckle_index: number;
    dropout_fraction: number;
    attitude_banding_score: number;
    usable: boolean;
    reason: string | null;
  };
  layers: {
    raw: string;
    enhanced: string;
    anomaly?: string;
  };
  provenance: {
    dataset_id: string;
    source_filename: string;
    licence: string;
    sha256: string;
  };
}

export interface EvidenceChannel {
  applicable: boolean;
  reason: string | null;
  score: number | null;
}

export interface Detection {
  detection_id: string;
  run_id: string;
  survey_id: string;
  frame_id: string;
  tile_id: string;
  kind: DetectionKind;
  source: DetectionSource;
  category: UnifiedClass;
  class_confidence: number | null;
  label_certainty: "CERTAIN" | "UNCERTAIN";
  anomaly_score: number | null;
  geometry: {
    bbox_px: [number, number, number, number];
    bbox_frame_px: [number, number, number, number];
    mask_rle: string | null;
    pics: {
    ping_centre: number | null;
    ping_span: number | null;
      range_centre_m: number | null;
      range_span_m: number | null;
      side: Channel;
      along_centre_px: number;
      across_centre_px: number;
    };
  };
  evidence: {
    persistence: EvidenceChannel & {
      mode: PersistenceMode | null;
      n_obs: number | null;
      n_opportunities: number | null;
      support_ratio: number | null;
      scatter_px: number | null;
      scatter_m: number | null;
      track_id: string | null;
    };
    shadow: EvidenceChannel & {
      contrast_z: number | null;
      continuity: number | null;
      ordering_ok: boolean | null;
      shadow_len_px: number | null;
      implied_height_m: number | null;
      height_assumptions: string[];
    };
    context: EvidenceChannel & {
      background_z: number | null;
      clutter_density: number | null;
    };
    completeness: string[];
  };
  fusion: {
    final_confidence: number | null;
    contributions: Record<string, number>;
    intercept: number | null;
    calibration_id: string | null;
    fusion_model_id: string | null;
    reason?: string | null;
  };
  dimensions: {
    length_px: number;
    width_px: number;
    length_m: number | null;
    width_m: number | null;
    area_m2: number | null;
    estimator: string;
    reason: string | null;
  };
  geo: {
    lat: number | null;
    lon: number | null;
    position_uncertainty_m: number | null;
    heading_deg: number | null;
    provenance: Provenance;
    nav_source: string | null;
    spatial_reference_level: SpatialReferenceLevel;
    reason: string | null;
  };
  model: {
    model_version_id: string;
    model_id: string;
    weights_sha256: string;
    confidence_at_prediction: number | null;
    device: string;
  };
  review: {
    latest_verdict: ReviewVerdict | null;
    review_count: number;
    reviewed_at: string | null;
    reviewer: string | null;
  };
  change_status: ChangeStatus | null;
  priority: { score?: number; rank?: number; applicable?: boolean; reason?: string };
  provenance: {
    class: Provenance;
    evidence: Provenance;
    fusion: Provenance;
    geo: Provenance;
    review: Provenance;
  };
}

export interface Review {
  review_id: string;
  detection_id: string;
  verdict: ReviewVerdict;
  corrected_class: UnifiedClass | null;
  corrected_bbox_px: [number, number, number, number] | null;
  notes: string;
  reviewer: string;
  created_at: string;
  model_version_id_at_prediction: string;
  confidence_at_prediction: number | null;
  training_eligible: boolean;
  training_eligible_reason: string | null;
  included_in_snapshots: string[];
  provenance: "OPERATOR_PROVIDED";
}

export interface SurveyChange {
  change_id: string;
  comparison_id: string;
  baseline_survey_id: string;
  new_survey_id: string;
  status: ChangeStatus;
  baseline_detection_id: string | null;
  new_detection_id: string | null;
  distance_m: number | null;
  match_score: number | null;
  inside_new_coverage: boolean;
  baseline_confirmed_by_operator: boolean;
  provenance: "HEURISTIC_DERIVED";
}

export interface ModelVersion {
  model_version_id: string;
  model_id: string;
  version: string;
  parent_model_version_id: string | null;
  architecture: string;
  init_from: string;
  framework: string;
  device_trained: string;
  weights_sha256: string;
  size_mb: number;
  snapshot_id: string;
  split_id: string;
  train_run_id: string;
  classes: UnifiedClass[];
  metrics_ref: string;
  calibration_id: string | null;
  review_examples_included: number;
  is_active: boolean;
  registered_at: string;
}

export interface Benchmark {
  run_id: string;
  git_sha: string | null;
  generated_at: string;
  device: string;
  split_id: string;
  split_assertions: Record<string, "PASS" | "FAIL">;
  detection: {
    overall: Record<"precision" | "recall" | "f1" | "map50" | "map50_95", number>;
    per_class: Record<string, Record<string, number>>;
    per_dataset?: Record<string, Record<string, number>>;
    per_site?: Record<string, Record<string, number>>;
    per_frequency?: Record<string, Record<string, number>>;
  };
  open_set: {
    status?: string;
    folds: Record<string, unknown>[];
    mean_auroc?: number;
    mean_auprc?: number;
    fpr_on_seabed?: number;
  };
  segmentation: Record<string, number | null>;
  operational: Record<string, unknown>;
  ablations: Record<string, unknown>[];
  stage3c?: {
    artifact_dir: string;
    calibration: { status: string; reason: string | null };
    validation: { known_candidates: number };
    test: { known_candidates: number };
  };
}

export interface RecoveryPriority {
  detection_id: string;
  score: number;
  rank: number;
  config_version: string;
  components: Record<
    string,
    { weight: number; value: number; contribution: number }
  >;
  provenance: "HEURISTIC_DERIVED";
  disclaimer: string;
}

export interface MemoryStats {
  reviewed: number;
  confirmed: number;
  rejected: number;
  relabelled: number;
  training_eligible: number;
  by_model_version: Record<string, number>;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    detail?: Record<string, unknown>;
  };
}

export interface Paged<T> {
  items: T[];
  total: number;
}

export type DataOrigin = "API" | "DEV_FIXTURE";
export interface Sourced<T> {
  origin: DataOrigin;
  data: T;
}
