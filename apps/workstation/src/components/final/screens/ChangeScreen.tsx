"use client";

import { useEffect, useState } from "react";
import { Badge, Unavailable } from "../parts/Primitives";
import { ApiError, failureSentence, fetchChangeReadiness } from "../runtime/api";
import type { ChangeReadiness, RuntimeSurvey, RuntimeSurveySummary } from "../runtime/types";

/**
 * Resurvey comparison.
 *
 * The product already has honest change semantics; what it did not have was a
 * place to see them. This screen states what each state means, shows the real
 * capability gates for the two surveys being compared, and — when the gates are
 * not met — says exactly which one is missing and why. It never produces a
 * comparison the evidence cannot support, and it never lets an absence read as
 * a removal.
 */

const STATE_TONE: Record<string, "ok" | "accent" | "warn" | "crit" | "null"> = {
  NEW: "accent",
  UNCHANGED: "ok",
  NOT_DETECTED: "warn",
  NOT_SURVEYED: "null",
  REMOVED: "crit",
};

export function ChangeScreen({
  survey,
  recent,
}: {
  survey: RuntimeSurvey | null;
  recent: RuntimeSurveySummary[];
}) {
  const [baseline, setBaseline] = useState<string>("");
  /* The answer is keyed by the question that produced it, so switching baseline
   * shows "asking" without an extra render pass to reset the previous answer. */
  const [answer, setAnswer] = useState<{
    key: string;
    result: ChangeReadiness | null;
    error: { message: string; retryable: boolean } | null;
  } | null>(null);

  const requestKey = survey ? `${survey.survey_id}::${baseline}` : "";
  const loading = Boolean(survey) && answer?.key !== requestKey;
  const result = answer?.key === requestKey ? answer.result : null;
  const error = answer?.key === requestKey ? answer.error : null;

  useEffect(() => {
    if (!survey) return;
    let live = true;
    const controller = new AbortController();
    fetchChangeReadiness(survey.survey_id, baseline || null, controller.signal)
      .then((value) => live && setAnswer({ key: requestKey, result: value, error: null }))
      .catch((cause: unknown) => {
        if (!live || controller.signal.aborted) return;
        setAnswer({
          key: requestKey,
          result: null,
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
  }, [survey, baseline, requestKey]);

  const candidates = recent.filter((item) => item.survey_id !== survey?.survey_id);

  return (
    <section className="sd-page sd-change">
      <h1>What changed since the last pass?</h1>
      <p className="sd-page-sub">
        Comparing two passes is a claim about the seabed, not about two files. This screen shows whether
        that claim is supportable for the surveys loaded here, and what would have to be true for it to be.
      </p>

      <h2 className="sd-section-heading">What each state means</h2>
      <div className="sd-change-semantics">
        {(result?.semantics ?? FALLBACK_SEMANTICS).map((item) => (
          <div key={item.state} className="sd-change-state">
            <Badge label={item.state.replace(/_/g, " ")} tone={STATE_TONE[item.state] ?? "null"} />
            <p>{item.meaning}</p>
          </div>
        ))}
      </div>

      <h2 className="sd-section-heading" style={{ marginTop: 34, display: "block" }}>
        Comparison readiness
      </h2>

      {!survey ? (
        <div style={{ marginTop: 12 }}>
          <Unavailable title="No survey is loaded">
            Load or upload a survey before asking what changed. Nothing is compared from an empty record
            set.
          </Unavailable>
        </div>
      ) : (
        <>
          <div className="sd-change-picker">
            <label htmlFor="sd-baseline">Baseline pass</label>
            <select
              id="sd-baseline"
              value={baseline}
              onChange={(event) => setBaseline(event.target.value)}
            >
              <option value="">No baseline selected</option>
              {candidates.map((item) => (
                <option key={item.survey_id} value={item.survey_id}>
                  {`${item.name}: ${item.contact_count} contacts, ${item.navigation_status === "AVAILABLE" ? "navigation supplied" : "no navigation"}`}
                </option>
              ))}
            </select>
            <span className="sd-change-picker-note">
              {candidates.length === 0
                ? "This service holds no other survey to compare against."
                : "Selecting a baseline asks the analysis service whether a comparison between the two is supportable."}
            </span>
          </div>

          {loading ? (
            <p className="sd-change-loading">Asking the analysis service…</p>
          ) : error ? (
            <div style={{ marginTop: 16 }}>
              <Unavailable title="Comparison readiness could not be checked">{error.message}</Unavailable>
            </div>
          ) : result ? (
            <>
              <div className="sd-change-verdict" data-supported={result.supported} role="status">
                <b>
                  {result.supported
                    ? "A comparison between these two passes is supportable."
                    : "A comparison between these two passes is refused."}
                </b>
                <span>
                  {result.supported
                    ? "Every capability gate below is met, so change states can be issued."
                    : "Producing change states here would state something about the seabed that the recorded evidence does not support."}
                </span>
              </div>

              {result.blockers.length > 0 ? (
                <div className="sd-change-blockers">
                  {result.blockers.map((blocker) => (
                    <div key={`${blocker.gate}-${blocker.reason}`} className="sd-change-blocker">
                      <b className="sd-mono">{blocker.gate.replace(/_/g, " ")}</b>
                      <p>{blocker.reason}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="sd-change-gates">
                <GateColumn title="This pass" gates={result.new_survey} />
                <GateColumn title="Baseline pass" gates={result.baseline_survey} />
              </div>

              <p className="sd-change-note">
                An absent contact is never reported as removed. Without a coverage polygon the service
                cannot even separate &ldquo;resurveyed and not detected&rdquo; from &ldquo;never
                resurveyed&rdquo;, so it reports neither.
              </p>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

function GateColumn({
  title,
  gates,
}: {
  title: string;
  gates: ChangeReadiness["new_survey"];
}) {
  const rows: readonly (readonly [string, string, boolean])[] = [
    ["Survey", gates.name ?? gates.survey_id ?? "Not selected", Boolean(gates.survey_id)],
    ["Navigation", gates.navigation_status, gates.navigation_status === "AVAILABLE"],
    [
      "Spatial reference level",
      gates.spatial_reference_level ?? "Unavailable",
      gates.spatial_reference_level === "L2_TRACK_RELATIVE" || gates.spatial_reference_level === "L3_SURVEYED",
    ],
    ["Coverage polygon", gates.coverage_polygon ? "Supplied" : "Not supplied", gates.coverage_polygon],
    ["Contacts", String(gates.contact_count ?? 0), (gates.contact_count ?? 0) > 0],
    [
      "Positioned observations",
      `${gates.positioned_observations} of ${gates.observation_count}`,
      gates.positioned_observations > 0,
    ],
  ];
  return (
    <div className="sd-gate-column">
      <h3 className="sd-eyebrow sd-eyebrow-md">{title}</h3>
      <dl className="sd-dl">
        {rows.map(([label, value, ok]) => (
          <div key={label} className="sd-gate-row" data-ok={ok}>
            <dt>{label}</dt>
            <dd className="sd-mono">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* Shown before the service answers, so the semantics are never blank. They are
 * the same definitions the service returns. */
const FALLBACK_SEMANTICS = [
  { state: "NEW", meaning: "Present in the new pass and not matched to any baseline contact inside coverage." },
  { state: "UNCHANGED", meaning: "Matched to a baseline contact under a supported matching rule." },
  {
    state: "NOT_DETECTED",
    meaning:
      "A baseline contact's location was resurveyed and nothing was detected there. This is a detector absence, not a removal.",
  },
  {
    state: "NOT_SURVEYED",
    meaning:
      "A baseline contact's location falls outside the new pass's coverage. Nothing at all is claimed about it.",
  },
  {
    state: "REMOVED",
    meaning:
      "Requires a prior contact, genuine new coverage, adequate localization and a validated matching and review decision. It is never inferred from a detector absence.",
  },
];
