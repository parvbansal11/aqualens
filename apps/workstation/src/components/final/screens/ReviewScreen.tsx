"use client";

import { useEffect } from "react";
import { Badge, Unavailable } from "../parts/Primitives";
import { SonarFrame } from "../parts/SonarFrame";
import {
  classLabel,
  confidenceLabel,
  coordinates,
  countReviewed,
  dimensions,
  frameMeta,
  reviewBadge,
  reviewText,
  sector,
  whySentence,
} from "../runtime/select";
import { BUTTONS, COPY, VERDICT_BUTTONS } from "../runtime/strings";
import type { RuntimeFinding, RuntimeSurvey, Verdict } from "../runtime/types";

/**
 * §5.8 Review queue — "Is this finding real?". The subject card is the one full
 * card in the product, because it is one object under judgement. Verdicts are
 * writes: a queue row shows the recorded verdict only after the write succeeds.
 */
export function ReviewScreen({
  survey,
  queue,
  index,
  onIndex,
  onVerdict,
  pending,
  failed,
  rasterFor,
  onBackToFindings,
  onGenerateReport,
  onOpenMemory,
  title,
}: {
  survey: RuntimeSurvey | null;
  queue: RuntimeFinding[];
  index: number;
  onIndex: (index: number) => void;
  onVerdict: (verdict: Verdict) => void;
  pending: string | null;
  failed: { id: string; message: string; retryable: boolean } | null;
  rasterFor: (finding: RuntimeFinding | null) => string | null;
  onBackToFindings: () => void;
  onGenerateReport: () => void;
  onOpenMemory: () => void;
  title: string;
}) {
  const findings = survey?.findings ?? [];
  const subject = queue[index] ?? queue[0] ?? null;
  const reviewed = countReviewed(findings);
  const total = findings.length;

  /* Keyboard shortcuts are global while this screen is mounted and released on
   * unmount. §5.8. */
  useEffect(() => {
    if (!subject) return;
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const match = VERDICT_BUTTONS.find(([, key]) => key.toLowerCase() === event.key.toLowerCase());
      if (!match) return;
      event.preventDefault();
      onVerdict(match[2]);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [subject, onVerdict]);

  if (total === 0) {
    return (
      <section className="sd-page sd-review">
        <div className="sd-review-head">
          <div>
            <h1>{title}</h1>
            <p>Nothing has been uploaded yet.</p>
          </div>
        </div>
        <Unavailable title="Nothing is waiting for review." className="sd-empty">
          No survey is loaded, so there are no finding records to judge. Upload a survey, or reopen one from
          the recent list in the sidebar.
        </Unavailable>
      </section>
    );
  }

  if (!subject) {
    return (
      <section className="sd-page sd-review">
        <div className="sd-review-head">
          <div>
            <h1>All findings reviewed</h1>
            <p>{`${reviewed} of ${total} reviewed`}</p>
          </div>
        </div>
        <p className="sd-review-memory-line">{COPY.reviewMemoryClosed}</p>
        <div className="sd-action-row">
          <button type="button" className="sd-btn-primary" onClick={onGenerateReport}>
            {BUTTONS.generateReport}
          </button>
          <button type="button" className="sd-btn-secondary" onClick={onOpenMemory}>
            {BUTTONS.openMemory}
          </button>
          <button type="button" className="sd-btn-secondary" onClick={onBackToFindings}>
            {BUTTONS.backToFindings}
          </button>
        </div>
      </section>
    );
  }

  const frame = survey?.frames.find((item) => item.frame_id === subject.source_frame_id);
  const badge = reviewBadge(subject);
  const progress = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  return (
    <section className="sd-page sd-review">
      <div className="sd-review-head">
        <div>
          <h1>{title}</h1>
          <p>{`${reviewed} of ${total} reviewed · press C, R, L or U to decide`}</p>
        </div>
        <div
          className="sd-review-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={reviewed}
          aria-label="Findings reviewed"
        >
          <span>
            <i style={{ width: `${progress}%` }} />
          </span>
        </div>
      </div>

      <div className="sd-subject">
        <div className="sd-subject-image" style={frame ? { aspectRatio: `${frame.width_px} / ${frame.height_px}` } : undefined}>
          {/* The target is drawn without the label tab: the class is stated below. */}
          <SonarFrame
            finding={subject}
            frame={frame}
            src={rasterFor(subject)}
            layer="raw"
            boxes
            showLabel={false}
          />
          <div className="sd-subject-plaque sd-mono">
            {`${subject.detection_id} · ${frameMeta(subject, frame)}`}
          </div>
        </div>
        <div className="sd-subject-body">
          <div>
            <div className="sd-subject-head">
              <h2>{classLabel(subject)}</h2>
              <Badge label={badge.label} tone={badge.tone} />
            </div>
            <p className="sd-subject-why">{whySentence(subject)}</p>
            <dl className="sd-subject-dl">
              <dt>{subject.classification_source === "DEMO_HEURISTIC" ? "Presentation label" : "Raw detector confidence"}</dt>
              <dt>Position</dt>
              <dt>Size</dt>
              <dd>{subject.classification_source === "DEMO_HEURISTIC" ? classLabel(subject) : confidenceLabel(subject.raw_confidence)}</dd>
              <dd className="sd-mono">{coordinates(subject)}</dd>
              <dd className="sd-mono">{dimensions(subject)}</dd>
            </dl>
          </div>
          <div>
            <small className="sd-eyebrow sd-eyebrow-md">Your decision</small>
            <div className="sd-verdicts">
              {VERDICT_BUTTONS.map(([label, key, verdict]) => (
                <button
                  key={verdict}
                  type="button"
                  disabled={pending === subject.detection_id}
                  onClick={() => onVerdict(verdict)}
                >
                  <span>{label}</span>
                  <kbd className="sd-mono">{key}</kbd>
                </button>
              ))}
            </div>
            <p className="sd-verdict-note">{COPY.reviewNote}</p>
            <button type="button" className="sd-btn-tertiary" onClick={onOpenMemory}>
              {BUTTONS.openMemory}
            </button>
            {failed && failed.id === subject.detection_id ? (
              <div className="sd-verdict-failure" role="alert">
                <p className="sd-error">{failed.message}</p>
                <p className="sd-verdict-failure-note">
                  {failed.retryable
                    ? "This decision was not recorded. Nothing was written, so pressing the key again records it exactly once. It is never resubmitted automatically, because this log is append-only."
                    : "This decision was not recorded and the service refused the request. It is not resubmitted automatically."}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="sd-queue">
        <small className="sd-eyebrow sd-eyebrow-md">Queue</small>
        <div className="sd-queue-list">
          {queue.map((finding, position) => {
            const recorded = finding.review_state !== null && finding.review_state !== undefined;
            const writeFailed = failed?.id === finding.detection_id;
            return (
              <button
                key={finding.detection_id}
                type="button"
                className="sd-queue-row"
                aria-current={position === index}
                onClick={() => onIndex(position)}
              >
                <div className="sd-queue-grid">
                  <span className="sd-mono">{String(position + 1).padStart(2, "0")}</span>
                  <b>{classLabel(finding)}</b>
                  <span className="sd-queue-sector">{sector(finding)}</span>
                  <span
                    className="sd-queue-verdict"
                    data-recorded={recorded}
                    data-failed={writeFailed}
                  >
                    {pending === finding.detection_id
                      ? "Saving"
                      : writeFailed
                        ? "Not saved"
                        : recorded
                          ? reviewText(finding)
                          : "Pending"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
