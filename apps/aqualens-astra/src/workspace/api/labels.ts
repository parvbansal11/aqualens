/**
 * Display words for backend codes. Values always come from the API; this file only says them in plain
 * language. An unknown code is shown in title case rather than hidden, so a new backend value is never lost.
 */
import type { EvidenceKey, EvidenceStatus, MachineClass, Priority, ReviewStatus } from "./types";

const titleCase = (code: string) => code.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const CLASS_LABEL: Record<MachineClass, string> = { PIPELINE: "Pipeline", SHIPWRECK: "Shipwreck", CRAB_POT: "Crab pot" };

const ANALYST: Record<string, { label: string; hint?: string }> = {
  FISHING_GEAR: { label: "Fishing gear", hint: "Pots, traps, lines" },
  ROPE_LINE: { label: "Rope or line" },
  NET_LIKE_DEBRIS: { label: "Net-like debris" },
  PLASTIC_DEBRIS: { label: "Plastic debris" },
  METALLIC_DEBRIS: { label: "Metallic debris" },
  CONTAINER_DRUM: { label: "Container or drum" },
  TYRE_RUBBER: { label: "Tyre or rubber" },
  CABLE_PIPELINE_RELATED: { label: "Cable or pipeline" },
  STRUCTURAL_DEBRIS: { label: "Structural debris" },
  NATURAL_FEATURE: { label: "Natural feature" },
  OTHER: { label: "Other", hint: "Add a note" },
  UNRESOLVED: { label: "Unresolved" },
};
export const analystLabel = (code: string) => ANALYST[code]?.label ?? titleCase(code);
export const analystHint = (code: string) => ANALYST[code]?.hint;

export const STATUS_LABEL: Record<ReviewStatus, string> = { UNREVIEWED: "Awaiting review", CONFIRMED: "Confirmed", REJECTED: "Rejected", UNRESOLVED: "Unresolved" };

export const PRIORITY_LABEL: Record<Priority, string> = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low", UNSET: "Not set" };
export const PRIORITY_RANK: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNSET: 4 };

export const AVAILABILITY_LABEL: Record<EvidenceStatus, string> = {
  AVAILABLE: "Available",
  UNAVAILABLE: "Unavailable",
  NOT_VALIDATED: "Not yet validated",
  NOT_APPLICABLE: "Not applicable",
  FAILED: "Failed",
};

export const EVIDENCE_LABEL: Record<EvidenceKey, string> = {
  detector: "Detector",
  local_anomaly: "Local anomaly",
  persistence: "Persistence",
  raised_relief: "Raised relief",
  navigation: "Navigation",
  analyst: "Analyst",
};

export const NAV_LABEL: Record<string, string> = {
  MEASURED: "Measured, as declared",
  DERIVED_FROM_SOURCE: "Derived from source",
  // Operator wording. The provenance code itself is shown only in technical surfaces (Report, System).
  SYNTHETIC_DEMO: "Provided survey track",
};
export const navLabel = (p: string | null | undefined) => (p ? NAV_LABEL[p] ?? titleCase(p) : "Unavailable");

export const MEMBERSHIP: Record<string, { label: string; text: string }> = {
  VERIFIED: { label: "Verified", text: "Frames share pings, verified from the rasters. Independent Looks are possible." },
  DECLARED: { label: "Declared", text: "Grouped by the upload's declaration. Declared membership never establishes persistence." },
  SINGLETON: { label: "Single Frame", text: "No membership declared or verified, so the Frame is its own Survey." },
  DEMO_FIXTURE: { label: "Demo fixture", text: "Deterministic demonstration Survey. Not a recording." },
};

export const ACTION_LABEL: Record<string, string> = {
  review: "Verdict",
  classification: "Classification",
  priority: "Priority",
  notes: "Note",
  fixture_analyst_verdict: "Scripted demo verdict",
};

/** Human names for backend evidence methods. The code stays visible on disclosure. */
export const METHOD_LABEL: Record<string, string> = {
  frozen_yolo11s: "Frozen YOLO11s detector",
  DEMO_FIXTURE_NOT_INFERENCE: "Demo fixture, not an inference run",
  survey_referenced_range_matched: "Survey-referenced, range-matched comparison",
  independent_looks: "Independent Looks",
  verified_along_track_continuity: "Verified along-track continuity",
  range_matched_acoustic_shadow: "Range-matched acoustic shadow",
  contact_localization: "Contact localization",
  DEMO_FIXTURE_NOT_LOCALIZATION: "Demo fixture, not a localization",
  human_semantic_review: "Human review",
};
export const methodLabel = (m: string) => METHOD_LABEL[m] ?? m;

/** Backend names end with " — DEMO" on demo records; the interface shows that as a tag instead. */
export const displayName = (name: string | null | undefined, fallback: string) => (name ?? fallback).replace(/\s*[—–-]\s*DEMO$/i, "");

export const shortTime = (iso: string | null | undefined) => {
  if (!iso) return "Unavailable";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** Where the service runs, as the backend reports it (/system/provenance deployment). */
export const DEPLOYMENT_LABEL: Record<string, string> = { LOCAL_WORKSTATION: "Local workstation", HOSTED_SERVICE: "Hosted service" };
