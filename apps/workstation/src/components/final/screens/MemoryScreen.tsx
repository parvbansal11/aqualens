"use client";

import { useEffect, useState } from "react";
import { Badge, Unavailable } from "../parts/Primitives";
import { ApiError, failureSentence, fetchMemoryEvents, fetchMemoryStats } from "../runtime/api";
import { confidenceLabel } from "../runtime/select";
import type { MemoryEvent, MemoryStats, RuntimeSurvey } from "../runtime/types";

/**
 * Review memory.
 *
 * Human-in-the-loop is the product's strongest claim, so it gets a screen that
 * shows exactly what happens to a verdict: it is appended, it is bucketed into
 * a named training-memory queue, and it is exported as a manifest. Nothing here
 * implies that recording a verdict changes a model. It does not.
 */

const QUEUES: readonly (readonly [keyof MemoryStats["queues"], string, string, "ok" | "crit" | "accent" | "warn"])[] = [
  [
    "confirmed_positive",
    "Confirmed positives",
    "Analyst-confirmed contacts. Future training memory for positives that the frozen detector already found.",
    "ok",
  ],
  [
    "hard_negative",
    "Hard negatives",
    "Analyst-rejected candidates with their source raster, context crop, box, raw evidence and verifier provenance. These are the only defensible negatives; an unreviewed detector hit is not one.",
    "crit",
  ],
  [
    "relabelled",
    "Relabels",
    "Candidates an analyst reassigned to a different class. Recorded as a correction against the class the detector emitted, which is left unchanged.",
    "accent",
  ],
  [
    "uncertain",
    "Uncertain",
    "Candidates an analyst could not decide. Kept separately, because an undecided candidate is neither a positive nor a negative.",
    "warn",
  ],
];

const QUEUE_LABEL: Record<string, string> = {
  confirmed_positive: "Confirmed positive",
  hard_negative: "Hard negative",
  relabelled: "Relabel",
  uncertain: "Uncertain",
  uncategorised: "Uncategorised",
};

export function MemoryScreen({ survey }: { survey: RuntimeSurvey | null }) {
  const [scope, setScope] = useState<"survey" | "all">("survey");
  /* Keyed by the request that produced it: switching scope shows the loading
   * state without a render pass that first clears the previous answer. */
  const [answer, setAnswer] = useState<{
    key: string;
    stats: MemoryStats | null;
    events: MemoryEvent[] | null;
    error: { message: string; retryable: boolean } | null;
  } | null>(null);

  const surveyId = survey?.survey_id ?? "";
  const requestKey = `${scope}::${surveyId}`;
  const loading = answer?.key !== requestKey;
  const stats = answer?.key === requestKey ? answer.stats : null;
  const events = answer?.key === requestKey ? answer.events : null;
  const error = answer?.key === requestKey ? answer.error : null;

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    Promise.all([
      fetchMemoryStats(controller.signal),
      fetchMemoryEvents(scope === "survey" ? surveyId || null : null, 100, controller.signal),
    ])
      .then(([statsValue, eventsValue]) => {
        if (!live) return;
        setAnswer({ key: requestKey, stats: statsValue, events: eventsValue.items, error: null });
      })
      .catch((cause: unknown) => {
        if (!live || controller.signal.aborted) return;
        setAnswer({
          key: requestKey,
          stats: null,
          events: null,
          error: {
            message: failureSentence(cause),
            retryable: cause instanceof ApiError ? cause.retryable : true,
          },
        });
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [scope, surveyId, requestKey]);

  return (
    <section className="sd-page sd-memory">
      <h1>Where analyst decisions go</h1>
      <p className="sd-page-sub">
        Every verdict an analyst records is appended to this survey&apos;s history and bucketed into a named
        training-memory queue. The queues are exported as manifests for a future supervised training or
        calibration round. Recording a verdict does not retrain, re-weight or re-score anything: the frozen
        detector this survey ran against is unchanged by everything on this screen.
      </p>

      {loading ? (
        <div className="sd-memory-queues">
          {QUEUES.map(([key]) => (
            <div className="sd-memory-queue" key={key}>
              <b>—</b>
            </div>
          ))}
        </div>
      ) : error ? (
        <div style={{ marginTop: 20 }}>
          <Unavailable title="Review memory could not be read">{error.message}</Unavailable>
        </div>
      ) : stats ? (
        <>
          <div className="sd-memory-queues">
            {QUEUES.map(([key, name, note, tone]) => (
              <div className="sd-memory-queue" key={key} data-tone={tone}>
                <b>{stats.queues[key]}</b>
                <small>{name}</small>
                <span>{note}</span>
              </div>
            ))}
          </div>

          <div className="sd-memory-summary">
            <div>
              <small>Recorded events</small>
              <b className="sd-mono">{stats.event_count}</b>
            </div>
            <div>
              <small>Observations reviewed</small>
              <b className="sd-mono">{`${stats.reviewed_observations} of ${stats.observations}`}</b>
            </div>
            <div>
              <small>Surveys with a decision</small>
              <b className="sd-mono">{`${stats.surveys_with_review} of ${stats.surveys_retained}`}</b>
            </div>
            <div>
              <small>Write mode</small>
              <b className="sd-mono">APPEND_ONLY</b>
            </div>
            <div>
              <small>Online learning</small>
              <b className="sd-mono">DISABLED</b>
            </div>
          </div>

          <h2 className="sd-section-heading" style={{ marginTop: 34, display: "block" }}>
            Export targets
          </h2>
          <div className="sd-memory-exports">
            {stats.export_targets.map((target) => (
              <span key={target} className="sd-mono">
                {target}
              </span>
            ))}
          </div>
          <p className="sd-memory-note">
            A manifest records the contact, its source observations, the source frame, the model prediction
            and raw confidence, the analyst verdict and the model version at the time of prediction. It does
            not copy imagery, and it is not applied to any model automatically.
          </p>

          <div className="sd-list-head" style={{ marginTop: 34 }}>
            <h2>Append-only history</h2>
            <span>Newest first</span>
            <div className="sd-seg sd-seg-inline" role="tablist" aria-label="History scope">
              <button
                type="button"
                role="tab"
                aria-selected={scope === "survey"}
                aria-controls="sd-memory-history"
                disabled={!survey}
                onClick={() => setScope("survey")}
              >
                This survey
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scope === "all"}
                aria-controls="sd-memory-history"
                onClick={() => setScope("all")}
              >
                All retained surveys
              </button>
            </div>
          </div>

          {events && events.length > 0 ? (
            <div className="sd-memory-events" id="sd-memory-history" role="tabpanel" aria-label="Append-only review history">
              {events.map((event) => (
                <div className="sd-memory-event" key={event.review_id}>
                  <div>
                    <div className="sd-memory-event-head">
                      <b>{event.verdict}</b>
                      <Badge label={QUEUE_LABEL[event.training_memory_queue] ?? event.training_memory_queue} tone="null" />
                    </div>
                    <span className="sd-mono">
                      {`${event.contact_id ?? event.detection_id} · ${event.raw_class} · raw ${confidenceLabel(event.raw_confidence)}`}
                    </span>
                  </div>
                  <span className="sd-memory-event-survey">{event.survey_name}</span>
                  <span className="sd-memory-event-by sd-mono">{event.reviewer}</span>
                  <span className="sd-memory-event-at sd-mono">
                    {new Date(event.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <Unavailable title="No decision has been recorded yet">
                {scope === "survey"
                  ? "No analyst verdict has been recorded against this survey. Open the review queue to record one."
                  : "No analyst verdict has been recorded against any survey this service holds."}
              </Unavailable>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
