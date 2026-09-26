import type { RuntimeSurvey, RuntimeContact, RuntimeFinding } from "./wire";
import type {
  Survey,
  Contact,
  ReviewState,
  EvidenceChannel,
  TrackPoint,
} from "./types";
import { position, numberOrNull, classLabel, finite } from "./selectors";
function review(v: unknown): ReviewState {
  return (
    (
      {
        CONFIRMED: "CONFIRMED",
        REJECTED: "REJECTED",
        FALSE_POSITIVE: "REJECTED",
        RELABELLED: "RELABELLED",
        UNCERTAIN: "UNCERTAIN",
        UNSURE: "UNCERTAIN",
      } as Record<string, ReviewState>
    )[String(v)] ?? "PENDING"
  );
}
export function adaptSurvey(raw: RuntimeSurvey, base: string): Survey {
  if (
    !raw ||
    typeof raw.survey_id !== "string" ||
    !Array.isArray(raw.frames) ||
    !Array.isArray(raw.findings)
  )
    throw new Error("The service returned an incomplete survey.");
  const id = encodeURIComponent(raw.survey_id);
  const frames = raw.frames.map((f) => ({
    id: f.frame_id,
    name: f.source_path?.split("/").pop() ?? f.frame_id,
    image: `${base}/runtime/surveys/${id}/frames/${encodeURIComponent(f.frame_id)}/raster`,
    width: f.width_px,
    height: f.height_px,
    position: position(
      f.navigation?.latitude,
      f.navigation?.longitude,
      (f.navigation as { depth_m?: number } | undefined)?.depth_m,
      f.navigation?.heading_deg,
    ),
  }));
  const observations = raw.findings.map((f) => ({
    id: f.detection_id,
    frameId: f.source_frame_id,
    rawClass: f.raw_class ?? null,
    rawScore: numberOrNull(f.raw_confidence),
    displayClass: f.display_class ?? null,
    classificationSource: f.classification_source ?? "MODEL",
    productionQualified: f.production_qualified === true,
    box:
      f.bbox_normalized?.length === 4 && f.bbox_normalized.every(finite)
        ? (f.bbox_normalized as [number, number, number, number])
        : null,
    modelId: f.model_id ?? null,
    modelSha: f.model_sha256 ?? null,
    pingStart: numberOrNull(f.ping_start),
    pingEnd: numberOrNull(f.ping_end),
  }));
  const contacts = (raw.contacts ?? []).map((c, i) =>
    adaptContact(c, raw.findings, i),
  );
  const track: (TrackPoint | null)[] = [];
  let segment: TrackPoint[] = [];
  const flush = () => {
    // ZIP member order is not a time axis. Supplied timestamps establish order.
    segment.sort((a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!));
    track.push(...segment);
    segment = [];
  };
  frames.forEach((frame, i) => {
    const timestamp = raw.frames[i].navigation?.timestamp_utc ?? null;
    if (!frame.position) {
      flush();
      track.push(null);
    } else if (timestamp && Number.isFinite(Date.parse(timestamp))) {
      segment.push({ ...frame.position, id: frame.id, timestamp });
    } else {
      // A position without acquisition order remains a fix, not a fabricated track.
      flush();
      track.push(
        null,
        { ...frame.position, id: frame.id, timestamp: null },
        null,
      );
    }
  });
  flush();
  return {
    id: raw.survey_id,
    name: raw.name,
    mission: raw.mission?.mission_id ?? null,
    missionNotes: raw.mission?.notes ?? null,
    createdAt: raw.created_at ?? null,
    source: "RUNTIME",
    description: raw.mission?.mission_type ?? "Side-scan sonar survey",
    frames,
    observations,
    contacts,
    track,
    comparisonSupported: false,
  };
}
function adaptContact(
  c: RuntimeContact,
  findings: RuntimeFinding[],
  i: number,
): Contact {
  const ids = Array.from(new Set(c.source_detection_ids ?? []));
  // A best ID outside the association does not silently adopt an unrelated observation.
  const best =
    findings.find(
      (f) =>
        ids.includes(f.detection_id) &&
        f.detection_id === c.best_observation_id,
    ) ?? findings.find((f) => ids.includes(f.detection_id));
  const os = c.open_set;
  const anomaly = numberOrNull(os?.anomaly_score ?? c.anomaly_score);
  const threshold = numberOrNull(os?.threshold ?? c.anomaly_threshold);
  const channels: EvidenceChannel[] = [];
  if (finite(c.quality_score))
    channels.push({
      id: "quality",
      label: "Sonar condition",
      state: "RECORDED",
      value: c.quality_score,
      detail:
        (c.quality_flags ?? []).join(" · ") ||
        "Measured raster quality. Vehicle motion is not inferred.",
    });
  if (c.pipeline_verification?.status)
    channels.push({
      id: "acoustic",
      label: "Acoustic evidence",
      state:
        c.pipeline_verification.hard_return_status === "PRESENT"
          ? "SUPPORTS"
          : c.pipeline_verification.hard_return_status === "WEAK"
            ? "WEAK"
            : "NOT MEASURED",
      value: numberOrNull(c.pipeline_verification.evidence_strength),
      detail:
        (c.pipeline_verification.reasons ?? []).join(" · ") ||
        c.pipeline_verification.status,
    });
  const persistence =
    c.persistence_evidence_type === "SEQUENTIAL_PING"
      ? {
          type: c.persistence_evidence_type,
          score: numberOrNull(c.persistence_score),
          frames: c.distinct_frame_observation_count ?? 0,
        }
      : null;
  if (persistence)
    channels.push({
      id: "persistence",
      label: "Temporal persistence",
      state: "RECORDED",
      value: persistence.score,
      detail: `${persistence.frames} distinct frames · supplied sequential pings`,
    });
  return {
    id: c.contact_id,
    shortId: `CT-${String(i + 1).padStart(2, "0")}`,
    label: classLabel(
      best?.classification_source === "DEMO_HEURISTIC"
        ? best.display_class
        : (c.resolved_class ?? best?.display_class),
    ),
    classKey: c.resolved_class ?? best?.raw_class ?? "OPEN_SET",
    observationIds: ids,
    bestObservationId: c.best_observation_id,
    confidence: numberOrNull(c.confidence),
    evidence: numberOrNull(c.evidence_strength ?? c.evidence_score),
    evidenceType:
      c.evidence_breakdown?.score_type ?? "UNVALIDATED_EVIDENCE_FUSION",
    review: review(c.reviews?.latest_verdict ?? best?.review_state),
    position: position(
      c.latitude,
      c.longitude,
      (c as { depth_m?: number }).depth_m,
      best?.heading_deg,
    ),
    persistence,
    openSet:
      anomaly === null
        ? null
        : {
            score: anomaly,
            threshold,
            candidate:
              os?.is_open_set_candidate ?? c.is_open_set_candidate ?? false,
            memory: os?.memory_version ?? c.anomaly_memory_version ?? null,
            thresholdSource:
              os?.threshold_source ?? c.anomaly_threshold_provenance ?? null,
          },
    priority: c.priority_band ?? null,
    channels,
    missingChannels: c.evidence_breakdown?.missing_components ?? [],
  };
}
