/* The single selector layer. ENGINEERING_CONTRACT §7.1: nothing on screen is a
 * hardcoded count, and every metric, badge count and header count derives from
 * the finding record set here, so no two roles can disagree about one survey.
 *
 * §7.2: null survives. A missing coordinate is never coalesced to 0 or "". */

import { ACTIONS, WHY } from "./strings";
import type {
  OpenSetEvidence,
  RuntimeContact,
  RuntimeFinding,
  RuntimeFrame,
  RuntimeSurvey,
} from "./types";

/* ---------------------------------------------------------------- classes */

/** §3 closed class enum. */
export type CanonicalClass =
  | "PIPELINE"
  | "WRECK_OR_STRUCTURAL_DEBRIS"
  | "DERELICT_FISHING_GEAR"
  | "ENGINEERING_STRUCTURE"
  | "UNKNOWN_ANOMALY_CANDIDATE";

const RUNTIME_TO_CANONICAL: Record<string, CanonicalClass> = {
  PIPELINE: "PIPELINE",
  SHIPWRECK: "WRECK_OR_STRUCTURAL_DEBRIS",
  CRAB_POT: "DERELICT_FISHING_GEAR",
};

const CLASS_LABEL: Record<CanonicalClass, string> = {
  PIPELINE: "Pipeline",
  WRECK_OR_STRUCTURAL_DEBRIS: "Wreck or structural debris",
  DERELICT_FISHING_GEAR: "Derelict fishing gear",
  ENGINEERING_STRUCTURE: "Engineering structure",
  /* §3: an unknown is never displayed as a class guess. */
  UNKNOWN_ANOMALY_CANDIDATE: "Unknown anomaly",
};

/** §7.5: an unrecognised class value renders as "Unknown anomaly", never raw. */
export function canonicalClass(finding: RuntimeFinding): CanonicalClass {
  return RUNTIME_TO_CANONICAL[finding.display_class] ?? "UNKNOWN_ANOMALY_CANDIDATE";
}

export function classLabel(finding: RuntimeFinding): string {
  return CLASS_LABEL[canonicalClass(finding)];
}

export function isUnknown(finding: RuntimeFinding): boolean {
  return canonicalClass(finding) === "UNKNOWN_ANOMALY_CANDIDATE";
}

/* ---------------------------------------------------------- review status */

export type BadgeTone = "ok" | "accent" | "warn" | "crit" | "null";

/** §1.6: status is text plus colour, never colour alone. */
export function reviewBadge(finding: RuntimeFinding): { label: string; tone: BadgeTone } {
  switch (finding.review_state) {
    case null:
    case undefined:
      return { label: "Needs review", tone: "warn" };
    case "CONFIRMED":
      return { label: "Confirmed", tone: "ok" };
    case "RELABELLED":
      return { label: "Relabelled", tone: "accent" };
    case "REJECTED":
      return { label: "Rejected", tone: "crit" };
    case "UNCERTAIN":
      return { label: "Uncertain", tone: "warn" };
    /* §7.5: any unrecognised status renders Unavailable grey, never a raw string. */
    default:
      return { label: "Unavailable", tone: "null" };
  }
}

/** The verdict text shown in a `dl` Review row and in the queue. */
export function reviewText(finding: RuntimeFinding): string {
  if (!finding.review_state) return "Not reviewed";
  return reviewBadge(finding).label;
}

export function awaitingDecision(finding: RuntimeFinding): boolean {
  return finding.review_state === null || finding.review_state === "UNCERTAIN";
}

/* -------------------------------------------------------------- priority */

export type Priority = "High" | "Review" | "Medium" | "Low";

/** §3 recovery priority, derived from the record set. Never sent as a scalar. */
export function priority(finding: RuntimeFinding): Priority {
  if (finding.review_state === "REJECTED") return "Low";
  if (awaitingDecision(finding)) return "Review";
  switch (canonicalClass(finding)) {
    case "PIPELINE":
      return "Low";
    case "ENGINEERING_STRUCTURE":
      return "Medium";
    case "UNKNOWN_ANOMALY_CANDIDATE":
      return "Medium";
    default:
      return "High";
  }
}

export function actionSentence(finding: RuntimeFinding): string {
  return ACTIONS[priority(finding)];
}

const PRIORITY_ORDER: Record<Priority, number> = { High: 0, Review: 1, Medium: 2, Low: 3 };

/** §5.5 sort: priority, then confidence descending. */
export function sortedFindings(findings: RuntimeFinding[]): RuntimeFinding[] {
  return findings
    .slice()
    .sort(
      (a, b) =>
        PRIORITY_ORDER[priority(a)] - PRIORITY_ORDER[priority(b)] ||
        (b.display_confidence ?? 0) - (a.display_confidence ?? 0),
    );
}

/* ----------------------------------------------------------------- counts */

export function countPositioned(findings: RuntimeFinding[]): number {
  return findings.filter((f) => f.geo.lat !== null && f.geo.lon !== null).length;
}

export function reviewQueue(findings: RuntimeFinding[]): RuntimeFinding[] {
  return sortedFindings(findings).filter(awaitingDecision);
}

export function countImportant(findings: RuntimeFinding[]): number {
  return findings.filter((f) => priority(f) === "High" || priority(f) === "Review").length;
}

export function countAction(findings: RuntimeFinding[]): number {
  return findings.filter(awaitingDecision).length;
}

export function countHigh(findings: RuntimeFinding[]): number {
  return findings.filter((f) => priority(f) === "High").length;
}

export function countConfirmed(findings: RuntimeFinding[]): number {
  return findings.filter((f) => f.review_state === "CONFIRMED").length;
}

export function countReviewed(findings: RuntimeFinding[]): number {
  return findings.filter((f) => f.review_state !== null && f.review_state !== undefined).length;
}

export function priorityFindings(findings: RuntimeFinding[]): RuntimeFinding[] {
  return sortedFindings(findings).filter(
    (f) => priority(f) === "High" || priority(f) === "Review",
  );
}

/* ------------------------------------------------------------ formatting */

/** §7.3: confidence is a fraction in the API and an integer percentage in the UI. */
export function confidenceLabel(value: number | null | undefined): string {
  return value === null || value === undefined ? "Unavailable" : `${Math.round(value * 100)}%`;
}

export function confidenceFraction(value: number | null | undefined): number {
  return value === null || value === undefined ? 0 : Math.max(0, Math.min(1, value));
}

/** §7.2: a missing coordinate renders the unavailable state, never a substitute. */
export function coordinates(finding: RuntimeFinding, absent = "Unavailable"): string {
  const { lat, lon } = finding.geo;
  if (lat === null || lon === null) return absent;
  return `${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E`;
}

export function hasPosition(finding: RuntimeFinding): boolean {
  return finding.geo.lat !== null && finding.geo.lon !== null;
}

/** §7.2 applies to navigation fields too: absent heading/timestamp renders the
 * unavailable state, never a substitute. */
export function headingLabel(finding: RuntimeFinding): string {
  const value = finding.heading_deg;
  return value === null || value === undefined ? "Unavailable" : `${value.toFixed(1)}°`;
}

export function timestampLabel(finding: RuntimeFinding): string {
  const value = finding.timestamp_utc;
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

/** Extent in source pixels. There is no range scale, so no metric value is issued. */
export function dimensions(finding: RuntimeFinding): string {
  const [x1, y1, x2, y2] = finding.bbox_px;
  if ([x1, y1, x2, y2].some((v) => typeof v !== "number")) return "Unavailable";
  return `${Math.round(x2 - x1)} × ${Math.round(y2 - y1)} px (image scale)`;
}

export function frameNumber(finding: RuntimeFinding): string {
  const digits = finding.source_frame_id.replace(/\D/g, "");
  return digits ? String(Number(digits) + 1).padStart(2, "0") : finding.source_frame_id;
}

/** The canonical "sector" slot. Real locator, not a fabricated sector name. */
export function sector(finding: RuntimeFinding): string {
  return `Frame ${frameNumber(finding)}`;
}

/** The canonical "Sector · ping N · side" line, bound to what actually exists. */
export function whereLine(finding: RuntimeFinding): string {
  const [x1, y1] = finding.bbox_px;
  return `${sector(finding)} · x ${Math.round(x1)} px · y ${Math.round(y1)} px`;
}

/** The canonical "Ping N · Side" slot. */
export function frameMeta(finding: RuntimeFinding, frame?: RuntimeFrame): string {
  if (frame) return `${sector(finding)} · ${frame.width_px} × ${frame.height_px} px`;
  return sector(finding);
}

export function whySentence(finding: RuntimeFinding): string {
  return WHY[canonicalClass(finding)] ?? WHY.UNKNOWN_ANOMALY_CANDIDATE;
}

/** The finding id without its survey prefix, for dense rows. Never a new id. */
export function shortId(finding: RuntimeFinding): string {
  const prefix = `det_${finding.survey_id}_`;
  return finding.detection_id.startsWith(prefix)
    ? finding.detection_id.slice(prefix.length)
    : finding.detection_id;
}

/** §7.6: provenance travels with every finding. */
export function provenance(finding: RuntimeFinding): string {
  return `${finding.model_id} · ${finding.run_id}`;
}

export function frameOf(survey: RuntimeSurvey | null, finding: RuntimeFinding | null) {
  if (!survey || !finding) return undefined;
  return survey.frames.find((f) => f.frame_id === finding.source_frame_id);
}

/** §7.4: box geometry is fractional, rendered as percentages inside the plate. */
export function boxRect(finding: RuntimeFinding) {
  const [x1, y1, x2, y2] = finding.bbox_normalized;
  return {
    left: `${(x1 * 100).toFixed(2)}%`,
    top: `${(y1 * 100).toFixed(2)}%`,
    width: `${((x2 - x1) * 100).toFixed(2)}%`,
    height: `${((y2 - y1) * 100).toFixed(2)}%`,
  };
}

/** Findings grouped by source frame, in frame order. Drives the strip cells. */
export function framesWithFindings(survey: RuntimeSurvey | null) {
  if (!survey) return [];
  return survey.frames.map((frame) => ({
    frame,
    findings: survey.findings.filter((f) => f.source_frame_id === frame.frame_id),
  }));
}

export function surveyTimestamp(survey: RuntimeSurvey | null): string {
  if (!survey) return "";
  const date = new Date(survey.created_at);
  if (Number.isNaN(date.getTime())) return survey.created_at;
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------------------------------------------------------------- contacts
 *
 * VNEXT_FINAL_PRODUCT_CONTRACT: the Contact is the primary operational object
 * and a raw detector observation is evidence beneath it. Everything a
 * contact-first view renders is derived here, from one join, so no two screens
 * can disagree about how many contacts a survey has or what state one is in.
 */


export type ContactView = {
  contact: RuntimeContact;
  /** The raw detector observations this Contact was fused from. */
  observations: RuntimeFinding[];
  /** The observation shown when the Contact is opened. Always a real record. */
  best: RuntimeFinding;
  label: string;
  unknown: boolean;
  badge: { label: string; tone: BadgeTone };
  reviewState: string | null;
  evidenceScore: number | null;
  /** Evidence channels the fusion could not use for this Contact. */
  missingEvidence: string[];
  openSet: OpenSetEvidence | undefined;
  openSetCandidate: boolean;
  positioned: boolean;
  observationCount: number;
  frameCount: number;
};

/** The backend's evidence-derived band. A transparent rule, not a risk model. */
export type EvidenceBand = "HIGH" | "MEDIUM" | "LOW" | "UNAVAILABLE";

export function evidenceBand(contact: RuntimeContact): EvidenceBand {
  const band = contact.priority_band;
  return band === "HIGH" || band === "MEDIUM" || band === "LOW" ? band : "UNAVAILABLE";
}

const EVIDENCE_BAND_LABEL: Record<EvidenceBand, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNAVAILABLE: "Unavailable",
};

export function evidenceBandLabel(contact: RuntimeContact): string {
  return EVIDENCE_BAND_LABEL[evidenceBand(contact)];
}

/** The backend's recommended action, as an operational instruction. */
const RECOMMENDED_ACTION: Record<string, string> = {
  REVIEW: "Needs an analyst decision before this position can be issued to a field team.",
  INSPECT: "Assign an inspection pass. The available evidence supports looking at this contact.",
  RECOVERY_CANDIDATE: "Confirmed by an analyst with strong available evidence. Carry into recovery planning.",
  REACQUIRE: "Re-acquire this window. The measured sonar quality is too poor to decide on.",
};

export function contactAction(contact: RuntimeContact): string {
  return RECOMMENDED_ACTION[contact.recommended_action ?? ""] ?? RECOMMENDED_ACTION.REVIEW;
}

/** The Contact a raw observation belongs to, if the runtime fused one. */
export function contactForFinding(
  contacts: RuntimeContact[] | undefined,
  finding: RuntimeFinding | null | undefined,
): RuntimeContact | undefined {
  if (!finding) return undefined;
  return contacts?.find(
    (item) =>
      item.source_detection_ids.includes(finding.detection_id) ||
      item.best_observation_id === finding.detection_id,
  );
}

function observationsOf(contact: RuntimeContact, findings: RuntimeFinding[]): RuntimeFinding[] {
  const wanted = new Set([
    ...(contact.source_detection_ids ?? []),
    ...(contact.best_observation_id ? [contact.best_observation_id] : []),
  ]);
  return findings.filter((item) => wanted.has(item.detection_id));
}

/** Representative observation for a Contact. Backend best_observation_id is
 * authoritative when it points at an associated finding; otherwise choose the
 * strongest legitimate raw detector output, with association order only as a
 * final deterministic fallback. */
export function representativeObservation(
  contact: RuntimeContact,
  observations: RuntimeFinding[],
): RuntimeFinding | undefined {
  if (contact.best_observation_id) {
    const designated = observations.find((item) => item.detection_id === contact.best_observation_id);
    if (designated) return designated;
  }
  const strongest = observations
    .filter((item) => typeof item.raw_confidence === "number" && Number.isFinite(item.raw_confidence))
    .reduce<RuntimeFinding | undefined>(
      (best, item) => (best === undefined || (item.raw_confidence ?? -Infinity) > (best.raw_confidence ?? -Infinity) ? item : best),
      undefined,
    );
  return strongest ?? observations[0];
}

const BAND_ORDER: Record<EvidenceBand, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, UNAVAILABLE: 3 };

/**
 * Contact views for a survey, ordered so the ones needing a human come first:
 * undecided before decided, then by evidence band, then by the strongest raw
 * detector confidence the Contact actually carries.
 */
export function contactViews(
  contacts: RuntimeContact[] | undefined,
  findings: RuntimeFinding[],
): ContactView[] {
  const views = (contacts ?? []).flatMap((contact): ContactView[] => {
    const observations = observationsOf(contact, findings);
    const best = representativeObservation(contact, observations);
    if (!best) return [];
    const reviewState = contact.reviews?.latest_verdict ?? best.review_state ?? null;
    const subject: RuntimeFinding = { ...best, review_state: reviewState };
    return [{
      contact,
      observations,
      best,
      label: classLabel(best),
      unknown: isUnknown(best),
      badge: reviewBadge(subject),
      reviewState,
      evidenceScore: contact.evidence_score ?? null,
      missingEvidence: contact.evidence_breakdown?.missing_components ?? [],
      openSet: contact.open_set,
      openSetCandidate: Boolean(contact.is_open_set_candidate),
      positioned: contact.latitude !== null && contact.latitude !== undefined
        && contact.longitude !== null && contact.longitude !== undefined,
      observationCount: observations.length,
      frameCount: new Set(observations.map((item) => item.source_frame_id)).size,
    }];
  });
  return views.sort((a, b) => {
    const undecided = Number(awaitingDecision({ ...a.best, review_state: a.reviewState }))
      - Number(awaitingDecision({ ...b.best, review_state: b.reviewState }));
    if (undecided !== 0) return -undecided;
    const band = BAND_ORDER[evidenceBand(a.contact)] - BAND_ORDER[evidenceBand(b.contact)];
    if (band !== 0) return band;
    return (b.contact.max_raw_confidence ?? 0) - (a.contact.max_raw_confidence ?? 0);
  });
}

export function contactViewFor(views: ContactView[], finding: RuntimeFinding | null): ContactView | undefined {
  if (!finding) return undefined;
  return views.find(
    (view) =>
      view.contact.source_detection_ids.includes(finding.detection_id) ||
      view.contact.best_observation_id === finding.detection_id,
  );
}

export function countOpenSetCandidates(views: ContactView[]): number {
  return views.filter((view) => view.openSetCandidate).length;
}

export function countContactsAwaiting(views: ContactView[]): number {
  return views.filter((view) => awaitingDecision({ ...view.best, review_state: view.reviewState })).length;
}

/** §7.3 again for the evidence score: two decimals, never a percentage. */
export function evidenceScoreLabel(value: number | null | undefined): string {
  return value === null || value === undefined ? "Unavailable" : value.toFixed(2);
}

/** Real per-frame navigation fixes, in frame order. Never interpolated. */
export function surveyTrack(survey: RuntimeSurvey | null): { frameId: string; lat: number; lon: number }[] {
  if (!survey) return [];
  return survey.frames.flatMap((frame) => {
    const nav = frame.navigation;
    if (!nav || nav.latitude === null || nav.longitude === null || nav.latitude === undefined || nav.longitude === undefined) {
      return [];
    }
    return [{ frameId: frame.frame_id, lat: nav.latitude, lon: nav.longitude }];
  });
}

/** Measured sonar condition for the frame an observation came from. */
export function conditionOf(survey: RuntimeSurvey | null, finding: RuntimeFinding | null) {
  if (!finding) return undefined;
  return finding.sonar_condition ?? frameOf(survey, finding)?.sonar_condition;
}
