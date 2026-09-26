import type {
  ChangeStatus,
  LayerMode,
  ReviewVerdict,
  SpatialReferenceLevel,
  UnifiedClass,
} from "@/lib/types";

export const CLASS_LABELS: Record<UnifiedClass, string> = {
  PIPELINE: "Pipeline",
  WRECK_OR_STRUCTURAL_DEBRIS: "Wreck or structural debris",
  DERELICT_FISHING_GEAR: "Derelict fishing gear",
  ENGINEERING_STRUCTURE: "Engineering structure",
  UNKNOWN_ANOMALY_CANDIDATE: "Unknown anomaly candidate",
};

export const LEVEL_LABELS: Record<SpatialReferenceLevel, string> = {
  L0_PIXEL_ONLY: "L0 pixel only",
  L1_TILE_RELATIVE: "L1 tile relative",
  L2_TRACK_RELATIVE: "L2 track relative",
  L3_SURVEYED: "L3 surveyed",
};

export const LAYER_LABELS: Record<LayerMode, string> = {
  raw: "RAW",
  enhanced: "ENHANCED",
  detections: "DETECTION",
  change: "CHANGE",
};

export const VERDICT_LABELS: Record<ReviewVerdict, string> = {
  CONFIRMED: "Confirm",
  REJECTED: "Reject",
  RELABELLED: "Relabel",
  UNCERTAIN: "Uncertain",
};

export const VERDICT_SHORTCUT: Record<ReviewVerdict, string> = {
  CONFIRMED: "C",
  REJECTED: "R",
  RELABELLED: "L",
  UNCERTAIN: "U",
};

/**
 * NOT_SURVEYED is deliberately worded as an absence of observation, never as a
 * clearance. Changing this copy changes a safety claim.
 */
export const CHANGE_STATUS_COPY: Record<ChangeStatus, string> = {
  NEW: "Observed on the current pass with no baseline match.",
  UNCHANGED: "Matched within tolerance on both passes.",
  REMOVED: "Inside the new coverage polygon, with no current observation matched.",
  NOT_SURVEYED: "Outside the new coverage polygon. Absence here is not a removal.",
};

export const CHANGE_STATUS_LABEL: Record<ChangeStatus, string> = {
  NEW: "New",
  UNCHANGED: "Unchanged",
  REMOVED: "Removed",
  NOT_SURVEYED: "Not surveyed",
};

export const CHANGE_STATUS_ACCENT: Record<ChangeStatus, string> = {
  NEW: "var(--ice)",
  UNCHANGED: "var(--stone)",
  REMOVED: "var(--danger)",
  NOT_SURVEYED: "var(--hatch)",
};
