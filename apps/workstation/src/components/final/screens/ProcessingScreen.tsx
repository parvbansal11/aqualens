"use client";

import { useState } from "react";
import { Unavailable } from "../parts/Primitives";
import { BUTTONS, COPY, PHASE_COPY, TITLES } from "../runtime/strings";
import type { JobStep, JobStepState, RuntimeJob, RuntimeSurvey } from "../runtime/types";

const STATE_WORD: Record<JobStepState, string> = {
  done: "Done",
  running: "Running",
  queued: "Queued",
  skipped: "Skipped",
  unavailable: "Unavailable",
  failed: "Failed",
};

function bytesLabel(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return "Unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A fact row: a real backend value, or the honest unavailable state. */
type Fact = { label: string; value: string; note?: string; tone?: "ok" | "warn" | "null" };

function facts(job: RuntimeJob | null): Fact[] {
  if (!job) return [];
  const upload = job.upload;
  const meta = job.metadata;
  const detector = job.detector;
  const openSet = job.open_set;
  const frames = job.source_frame_count ?? upload?.raster_count ?? 0;
  return [
    {
      label: "Upload decoded",
      value: upload?.decoded ? (upload.kind === "BUNDLE" ? "Bundle extracted" : "Raster read") : "Not decoded",
      note: upload
        ? `${upload.filename ?? "upload"} · ${bytesLabel(upload.bytes)}${upload.bundle_entries !== null && upload.bundle_entries !== undefined ? ` · ${upload.bundle_entries} bundle entries` : ""}`
        : undefined,
      tone: upload?.decoded ? "ok" : "null",
    },
    {
      label: "Source frames",
      value: String(frames),
      note:
        job.frames_completed !== undefined && frames > 0
          ? `${job.frames_completed} of ${frames} inferred`
          : "Counted from the decoded upload",
      tone: "ok",
    },
    {
      label: "Navigation metadata",
      value: meta?.navigation === "AVAILABLE" ? "Supplied" : "Not supplied",
      note:
        meta?.navigation === "AVAILABLE"
          ? "Frames referenced by navigation.csv carry a supplied latitude and longitude."
          : "No navigation.csv accompanies this upload, so no finding carries a position.",
      tone: meta?.navigation === "AVAILABLE" ? "ok" : "null",
    },
    {
      label: "Mission metadata",
      value: meta?.mission === "AVAILABLE" ? "Supplied" : "Not supplied",
      note: meta?.sequential_observation_contract
        ? "A sequential recording contract is declared, so ping order can be used as persistence evidence."
        : "No sequential recording contract is declared, so frame order is not treated as persistence evidence.",
      tone: meta?.mission === "AVAILABLE" ? "ok" : "null",
    },
    {
      label: "Frozen detector",
      value: detector?.availability === "AVAILABLE" ? (detector.loaded ? "Loaded" : "Verified") : "Unavailable",
      note: detector
        ? `${detector.device} · checkpoint ${detector.model_sha256 ? `${detector.model_sha256.slice(0, 12)}…` : "digest unavailable"}`
        : undefined,
      tone: detector?.availability === "AVAILABLE" ? "ok" : "warn",
    },
    {
      label: "Open-set evidence",
      value: openSet?.availability === "AVAILABLE" ? "Available" : (openSet?.availability ?? "NOT_CONFIGURED").replace(/_/g, " ").toLowerCase(),
      note:
        openSet?.availability === "AVAILABLE"
          ? `${openSet.memory_version ?? "reference memory"} · threshold ${openSet.threshold?.toFixed(3) ?? "unavailable"} (${openSet.threshold_source ?? "source unavailable"})`
          : "No open-set reference memory is configured in this deployment.",
      tone: openSet?.availability === "AVAILABLE" ? "ok" : "null",
    },
    {
      label: "Contacts fused",
      value: job.contacts_fused === null || job.contacts_fused === undefined ? "—" : String(job.contacts_fused),
      note:
        job.contacts_fused === null || job.contacts_fused === undefined
          ? "Fusion has not run yet."
          : `From ${job.detections_generated} raw detector observation${job.detections_generated === 1 ? "" : "s"}.`,
      tone: job.contacts_fused ? "ok" : "null",
    },
    {
      label: "Report records",
      value: job.report_ready ? "Written" : "Not written",
      note: job.report_ready
        ? "The survey record is persisted and exportable."
        : "Nothing is exportable until the run completes.",
      tone: job.report_ready ? "ok" : "null",
    },
  ];
}

/**
 * §5.4 processing. Every state on this screen is published by the backend with
 * the job (`sagar/api/jobs.py`) after the work it names has actually happened.
 * There is no estimated completion figure anywhere: the only ratio shown is
 * frames inferred over frames decoded, and both are counted.
 */
export function ProcessingScreen({
  job,
  inFlight,
  error,
  errorKind,
  survey,
  filmstripSrc,
  subtitle,
  onRetry,
  onBackToUpload,
}: {
  job: RuntimeJob | null;
  inFlight: boolean;
  error: string | null;
  /** Set when the upload itself was refused or never reached the service. */
  errorKind?: "UPLOAD_REJECTED" | "SERVICE_UNREACHABLE" | null;
  survey: RuntimeSurvey | null;
  filmstripSrc: string | null;
  subtitle: string;
  onRetry: () => void;
  onBackToUpload: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const uploadFailed = Boolean(errorKind);
  const state = job?.state ?? (inFlight ? "QUEUED" : "QUEUED");
  const failed = uploadFailed || state === "FAILED";
  const completed = !uploadFailed && state === "COMPLETED";
  const running = !failed && !completed && (inFlight || state !== "QUEUED");

  const steps: JobStep[] = job?.steps ?? [];
  const frames = job?.source_frame_count ?? 0;
  const done = job?.frames_completed ?? 0;

  const title = failed ? TITLES.processingFailed : completed ? TITLES.processingDone : TITLES.processing;

  const failureHeading = uploadFailed
    ? errorKind === "SERVICE_UNREACHABLE"
      ? "The analysis service could not be reached"
      : "This upload was not accepted"
    : "Processing did not complete";
  const failureReason =
    error ??
    job?.error?.message ??
    "The analysis service did not complete the run and did not report a reason.";
  const failurePhase = job?.error?.phase ? PHASE_COPY[job.error.phase]?.[0] ?? job.error.phase : null;

  return (
    <section className="sd-page sd-processing">
      <h1>{title}</h1>
      <p className="sd-processing-sub">{subtitle}</p>

      <div className="sd-filmstrip">
        {filmstripSrc ? (
          /* eslint-disable-next-line @next/next/no-img-element -- the filmstrip
             shows the raster actually being processed: a local object URL before
             the run, and the retained runtime upload after it. */
          <img src={filmstripSrc} alt="Sonar imagery being processed" />
        ) : (
          <div className="sd-filmstrip-empty">No raster is loaded for this run.</div>
        )}
        {/* The sweep decorates a known running state only. Queued and failed do
         * not animate: the interface never animates progress it is not observing. */}
        {running ? (
          <div className="sd-filmstrip-sweep">
            <i />
          </div>
        ) : null}
      </div>

      {failed ? (
        <div className="sd-processing-failure" role="alert">
          <Unavailable title={failureHeading}>
            {failureReason}
            {failurePhase ? ` The run stopped at: ${failurePhase}.` : ""}
            {errorKind === "SERVICE_UNREACHABLE"
              ? " Nothing was uploaded and no survey state was changed."
              : uploadFailed
                ? " No inference was run and no survey record was created."
                : " No partial survey record was written."}
          </Unavailable>
        </div>
      ) : null}

      {frames > 0 && !uploadFailed ? (
        <div className="sd-frame-progress" aria-live="polite">
          <div className="sd-frame-progress-head">
            <span>Source frames inferred</span>
            {/* A counted ratio, not an estimate. */}
            <b className="sd-mono">{`${done} / ${frames}`}</b>
          </div>
          <div
            className="sd-frame-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={frames}
            aria-valuenow={done}
            aria-label="Source frames inferred"
          >
            <i style={{ width: `${frames > 0 ? (done / frames) * 100 : 0}%` }} data-failed={failed} />
          </div>
        </div>
      ) : null}

      {job ? (
        <>
          <button
            type="button"
            className="sd-disclosure"
            aria-expanded={detailsOpen}
            aria-controls="sd-processing-facts"
            onClick={() => setDetailsOpen((value) => !value)}
          >
            <span>{detailsOpen ? BUTTONS.processingDetailsClose : BUTTONS.processingDetailsOpen}</span>
            <span aria-hidden="true">{detailsOpen ? "▴" : "▾"}</span>
          </button>
          {detailsOpen ? (
            <div className="sd-facts" id="sd-processing-facts" aria-label="What the analysis service observed">
              {facts(job).map((fact) => (
                <div className="sd-fact" key={fact.label} data-tone={fact.tone ?? "null"}>
                  <small>{fact.label}</small>
                  <b>{fact.value}</b>
                  {fact.note ? <span>{fact.note}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      <h2 className="sd-eyebrow sd-eyebrow-md sd-processing-phases-title">Processing phases</h2>
      <div className="sd-stages">
        {steps.length === 0 ? (
          <p className="sd-processing-note">
            {uploadFailed
              ? "No run was started, so there are no phases to report."
              : "Waiting for the analysis service to accept this upload."}
          </p>
        ) : (
          steps.map((step) => {
            const copy = PHASE_COPY[step.id];
            return (
              <div className="sd-stage" key={step.id} data-state={step.state}>
                <i />
                <div>
                  <b>{copy?.[0] ?? step.label}</b>
                  <span>{step.detail ?? copy?.[1] ?? ""}</span>
                </div>
                <em className="sd-mono">{STATE_WORD[step.state]}</em>
              </div>
            );
          })
        )}
      </div>

      <p className="sd-processing-note">{COPY.processingFoot}</p>

      {failed ? (
        <div className="sd-processing-actions">
          <button type="button" className="sd-btn-primary" onClick={onRetry}>
            Process this file again
          </button>
          <button type="button" className="sd-btn-secondary" onClick={onBackToUpload}>
            Choose a different file
          </button>
          <p className="sd-processing-foot">
            Processing again starts a new run and creates a new survey record. Nothing already recorded is
            overwritten or deleted.
          </p>
        </div>
      ) : (
        <p className="sd-processing-foot">
          {completed && survey
            ? `${survey.contacts?.length ?? 0} contact${(survey.contacts?.length ?? 0) === 1 ? "" : "s"} fused from ${survey.findings.length} raw detector observation${survey.findings.length === 1 ? "" : "s"} across ${survey.frames.length} source ${survey.frames.length === 1 ? "frame" : "frames"}.`
            : "Opening the workspace as soon as the analysis service reports the run complete."}
        </p>
      )}
    </section>
  );
}
