"use client";

import type { ReactNode } from "react";
import {
  classLabel,
  confidenceLabel,
  conditionOf,
  coordinates,
  evidenceBandLabel,
  evidenceScoreLabel,
  headingLabel,
  timestampLabel,
  type ContactView,
} from "../runtime/select";
import type { RuntimeContact, RuntimeFinding, RuntimeSurvey } from "../runtime/types";

/**
 * The evidence ladder.
 *
 * One row per evidence channel, in the order an analyst reasons about them:
 * what the detector saw, whether it persisted, where it was, what the water
 * looked like, what the acoustics supported, how unusual it was, how those
 * combined, who decided, and what to do next.
 *
 * Every row is closed by default and states its headline value on the closed
 * summary, so the first view is readable and the full numbers are one keypress
 * away. A channel that produced nothing renders as unavailable with the reason
 * -- never as a zero, and never omitted, because an omitted channel reads as an
 * absent problem.
 */

type RowState = "available" | "unavailable" | "advisory" | "attention";

function Row({
  name,
  value,
  state,
  children,
}: {
  name: string;
  value: string;
  state: RowState;
  children: ReactNode;
}) {
  return (
    <details className="sd-ev-row" data-state={state}>
      <summary>
        <span className="sd-ev-name">
          <i aria-hidden="true" />
          {name}
        </span>
        <span className="sd-ev-value sd-mono">{value}</span>
        <em aria-hidden="true">▾</em>
      </summary>
      <div className="sd-ev-body">{children}</div>
    </details>
  );
}

function Pairs({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="sd-ev-dl">
      {rows.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd className="sd-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function decimal(value: number | null | undefined, digits = 3): string {
  return value === null || value === undefined ? "Unavailable" : value.toFixed(digits);
}

function text(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "Unavailable" : value;
}

const PERSISTENCE_MEANING: Record<string, string> = {
  SEQUENTIAL_PING:
    "The same object was observed across consecutive pings declared by the recording metadata. This is genuine sequential persistence.",
  WINDOW_OVERLAP_ONLY:
    "The observations repeat only across overlapping analysis windows of one source frame. Window overlap is not sequential persistence and is not scored as such.",
  SINGLE_OBSERVATION:
    "One observation only. A single observation carries no persistence evidence, so persistence contributes its floor value to fusion.",
  UNKNOWN:
    "Observations came from more than one frame, but the upload declared no recording sequence, so their order carries no temporal meaning.",
};

export function EvidenceLadder({
  view,
  finding,
  survey,
}: {
  view: ContactView | undefined;
  finding: RuntimeFinding;
  survey: RuntimeSurvey | null;
}) {
  const contact: RuntimeContact | undefined = view?.contact;
  const condition = conditionOf(survey, finding);
  const pipeline = contact?.pipeline_verification ?? finding.pipeline_verification;
  const openSet = contact?.open_set ?? finding.open_set;
  const breakdown = contact?.evidence_breakdown;
  const components = breakdown?.components ?? {};
  const missing = breakdown?.missing_components ?? [];
  const positioned = finding.geo.lat !== null && finding.geo.lon !== null;
  const persistenceType = contact?.persistence_evidence_type ?? "SINGLE_OBSERVATION";
  const reviewCount = contact?.reviews?.review_count ?? finding.review_history.length;
  const latestReview = finding.review_history[finding.review_history.length - 1];
  const demoPresentation = finding.classification_source === "DEMO_HEURISTIC";

  return (
    <div className="sd-ev" aria-label="Evidence for this contact">
      {/* 1 — the immutable observation */}
      <Row
        name="What the detector saw"
        value={`${finding.raw_class} · ${confidenceLabel(finding.raw_confidence)}`}
        state="available"
      >
        <p>
          The frozen YOLO11s detector is a candidate generator over three known classes. This row is its
          unmodified output: no later stage rewrites the class, the confidence or the box.
        </p>
        <Pairs
          rows={demoPresentation
            ? [
                ["Presentation label", classLabel(finding)],
                ["Classification source", "Demo heuristic"],
                ["Raw detector output", `${finding.raw_class} · ${confidenceLabel(finding.raw_confidence)}`],
                ["Production qualified", "No"],
                ["Inference mode", text(finding.inference_mode)],
                ["Model", finding.model_id],
                ["Checkpoint digest", finding.model_sha256],
                ["Producing run", finding.run_id],
              ]
            : [
                ["Raw detector class", finding.raw_class],
                ["Raw detector confidence", confidenceLabel(finding.raw_confidence)],
                ["Displayed class", classLabel(finding)],
                ["Displayed confidence", confidenceLabel(finding.display_confidence)],
                ["Classification source", finding.classification_source],
                ["Production qualified", finding.production_qualified ? "Yes" : "No"],
                ["Inference mode", text(finding.inference_mode)],
                ["Model", finding.model_id],
                ["Checkpoint digest", finding.model_sha256],
                ["Producing run", finding.run_id],
              ]}
        />
        {demoPresentation ? (
          <p className="sd-ev-caution">
            INTERNAL DEMO ONLY, not production calibration. The presentation label comes from a demo
            heuristic; it has no confidence value. The raw detector output above is unchanged, and this
            policy never appears in the Model Lab as measured performance.
          </p>
        ) : null}
      </Row>

      {/* 2 — persistence */}
      <Row
        name="Persistence"
        value={persistenceType.replace(/_/g, " ").toLowerCase()}
        state={persistenceType === "SEQUENTIAL_PING" ? "available" : "unavailable"}
      >
        <p>{PERSISTENCE_MEANING[persistenceType] ?? PERSISTENCE_MEANING.UNKNOWN}</p>
        <Pairs
          rows={[
            ["Evidence type", persistenceType],
            ["Observations in this contact", String(contact?.observation_count ?? view?.observationCount ?? 1)],
            ["Distinct source frames", String(contact?.distinct_frame_observation_count ?? view?.frameCount ?? 1)],
            ["Window-overlap duplicates", String(contact?.window_overlap_duplicate_count ?? 0)],
            ["Persistence score", decimal(contact?.persistence_score, 2)],
            ["Declared ping bounds", finding.ping_start !== null && finding.ping_start !== undefined
              ? `${finding.ping_start} – ${finding.ping_end}`
              : "Unavailable"],
          ]}
        />
      </Row>

      {/* 3 — navigation */}
      <Row
        name="Navigation"
        value={positioned ? "Supplied" : "Not supplied"}
        state={positioned ? "available" : "unavailable"}
      >
        <p>
          Coordinates are copied from a supplied navigation record for the source frame. No coordinate is
          ever derived from the sonar imagery, and a frame with no matching record stays null.
        </p>
        <Pairs
          rows={[
            ["Position", coordinates(finding)],
            ["Heading", headingLabel(finding)],
            ["Timestamp (UTC)", timestampLabel(finding)],
            ["Navigation status", text(finding.navigation_status)],
            ["Localization uncertainty", text(contact?.localization_uncertainty_status)],
          ]}
        />
        {!positioned ? (
          <p className="sd-ev-note">
            Full pixel-to-world georeferencing needs calibrated ping timing and range, side and channel
            orientation, heading and attitude, altitude, and validated platform alignment. Without those,
            position and its uncertainty stay unavailable rather than estimated.
          </p>
        ) : null}
      </Row>

      {/* 4 — measured sonar condition */}
      <Row
        name="Sonar condition"
        value={condition ? `${condition.quality_grade ?? "Unavailable"} · ${decimal(condition.quality_score, 2)}` : "Unavailable"}
        state={condition ? (condition.quality_grade === "POOR" ? "attention" : "available") : "unavailable"}
      >
        <p>
          Measured properties of the raster this observation came from. A dark band is measured as a dark
          band; it is not diagnosed as shadow, sensor dropout or a nadir gap, because those cannot be told
          apart without calibrated acquisition metadata.
        </p>
        {condition ? (
          <>
            <Pairs
              rows={[
                ["Quality grade", text(condition.quality_grade)],
                ["Quality score", decimal(condition.quality_score, 3)],
                ["Dynamic range", decimal(condition.dynamic_range)],
                ["Usable fraction", decimal(condition.usable_fraction)],
                ["Horizontal dark-band fraction", decimal(condition.dropout_fraction)],
                ["Central dark-band fraction", decimal(condition.nadir_fraction)],
                ["Motion quality", text(condition.motion_quality)],
                ["Flags", (condition.quality_flags ?? []).join(", ") || "None"],
              ]}
            />
            <p className="sd-ev-note">
              Motion quality is UNKNOWN because no motion metadata accompanies this upload. Image heuristics
              are not a measurement of vehicle motion.
            </p>
          </>
        ) : (
          <p className="sd-ev-note">No condition assessment is recorded for this observation&apos;s source frame.</p>
        )}
      </Row>

      {/* 5 — acoustic verification */}
      <Row
        name="Acoustic verification"
        value={
          finding.raw_class !== "PIPELINE"
            ? "Not applicable"
            : pipeline?.status === "INSUFFICIENT_EVIDENCE"
              ? "Insufficient evidence"
              : text(pipeline?.status)
        }
        state={finding.raw_class !== "PIPELINE" || !pipeline ? "unavailable" : "advisory"}
      >
        {finding.raw_class !== "PIPELINE" ? (
          <p>
            The acoustic verifier runs only for raw PIPELINE candidates. It is not run for this class, so no
            acoustic verification state exists for this observation. That is an absence of evidence, not
            evidence against it.
          </p>
        ) : (
          <>
            <p>
              Local raster measurements around the candidate. This verifier never changes the detector&apos;s
              class, confidence or box. INSUFFICIENT_EVIDENCE means the measurement could not support or
              contradict the candidate; it is not a false-positive verdict, and NOT_OBSERVED does not prove
              that no physical hard return exists.
            </p>
            <Pairs
              rows={[
                ["Verification state", text(pipeline?.status)],
                ["Hard return", text(pipeline?.hard_return_status)],
                ["Shadow geometry", text(pipeline?.shadow_status)],
                ["Local contrast", decimal(pipeline?.local_contrast)],
                ["Bright pixel fraction", decimal(pipeline?.candidate_bright_fraction)],
                ["Dark pixel fraction", decimal(pipeline?.candidate_dark_fraction)],
                ["Bounding-box elongation", decimal(pipeline?.elongation)],
                ["Missing inputs", (pipeline?.missing_inputs ?? []).join(", ") || "None"],
                ["Measurement notes", (pipeline?.reasons ?? []).join("; ") || "None"],
              ]}
            />
            <p className="sd-ev-note">
              Axis-aligned boxes do not establish object orientation, so shadow direction and
              highlight-shadow consistency stay unavailable without calibrated range-side geometry.
            </p>
          </>
        )}
      </Row>

      {/* 6 — open-set */}
      <Row
        name="Open-set anomaly"
        value={
          openSet?.status === "AVAILABLE"
            ? `${decimal(openSet.anomaly_score, 3)} vs ${decimal(openSet.threshold, 3)}`
            : openSet?.status === "FAILED"
              ? "Scoring failed"
              : "Unavailable"
        }
        state={
          openSet?.status !== "AVAILABLE"
            ? "unavailable"
            : openSet.is_open_set_candidate
              ? "attention"
              : "available"
        }
      >
        <p>
          The anomaly score is the distance from a memory of background patches taken from the training
          split. A higher score means this candidate&apos;s context is less similar to that reference
          background. It is not a probability, not a known-class confidence, and not proof that the contact
          is artificial or previously unseen.
        </p>
        {openSet?.status === "AVAILABLE" ? (
          <>
            <Pairs
              rows={[
                ["Anomaly score", decimal(openSet.anomaly_score, 4)],
                ["Threshold", decimal(openSet.threshold, 4)],
                ["Threshold source", text(openSet.threshold_source)],
                ["Feature source", text(openSet.feature_source)],
                ["Memory version", text(openSet.memory_version)],
                [
                  "State",
                  openSet.is_open_set_candidate
                    ? "Above threshold, surfaced for analyst review"
                    : "Within the reference range",
                ],
              ]}
            />
            <p className="sd-ev-note">
              Exceeding the threshold does not create a fourth detector class and does not change the raw
              class above. It asks for an analyst decision.
            </p>
          </>
        ) : (
          <p className="sd-ev-note">
            {openSet?.status === "FAILED"
              ? `Open-set scoring failed for this observation. Missing inputs: ${(openSet.missing_inputs ?? []).join(", ") || "unreported"}. The channel is excluded from fusion rather than scored as zero.`
              : "No open-set reference memory is configured in this deployment, so this channel is excluded from fusion rather than scored as zero."}
          </p>
        )}
      </Row>

      {/* 7 — fusion */}
      <Row
        name="Evidence fusion"
        value={evidenceScoreLabel(view?.evidenceScore ?? null)}
        state={view?.evidenceScore === null || view?.evidenceScore === undefined ? "unavailable" : "advisory"}
      >
        <p>
          {breakdown?.score_type ?? "UNVALIDATED_EVIDENCE_FUSION"} over the channels that were actually
          available for this Contact. The weights are versioned and explicit. An unavailable channel is
          excluded and the remaining weights are renormalised; it is never scored as zero. This number has
          not been validated against outcomes and is not a probability.
        </p>
        {Object.keys(components).length > 0 ? (
          <table className="sd-ev-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th className="sd-num">Value</th>
                <th className="sd-num">Weight</th>
                <th className="sd-num">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(components).map(([name, part]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="sd-num sd-mono">{decimal(part.value, 3)}</td>
                  <td className="sd-num sd-mono">{decimal(part.normalized_weight, 3)}</td>
                  <td className="sd-num sd-mono">{decimal(part.contribution, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <Pairs
          rows={[
            ["Score type", text(breakdown?.score_type)],
            ["Policy version", text(breakdown?.policy_version)],
            ["Unavailable channels", missing.join(", ") || "None"],
          ]}
        />
      </Row>

      {/* 8 — human review */}
      <Row
        name="Analyst review"
        value={view?.badge.label ?? "Needs review"}
        state={view?.reviewState ? "available" : "attention"}
      >
        <p>
          Review is append-only. A new verdict adds an event; it never edits or deletes an earlier one, and
          it never changes the raw detector output above. Verdicts accumulate as curated training and
          calibration memory. Nothing is retrained by recording one.
        </p>
        <Pairs
          rows={[
            ["Latest verdict", text(view?.reviewState)],
            ["Recorded events", String(reviewCount)],
            ["Last reviewer", text(latestReview?.reviewer)],
            ["Last recorded", latestReview?.created_at ? new Date(latestReview.created_at).toLocaleString() : "Unavailable"],
          ]}
        />
      </Row>

      {/* 9 — priority */}
      <Row
        name="Recovery priority"
        value={contact ? evidenceBandLabel(contact) : "Unavailable"}
        state={contact?.priority_band === "HIGH" ? "attention" : contact ? "advisory" : "unavailable"}
      >
        <p>
          A transparent rule over the evidence that is available, not a learned risk model and not an
          ecological assessment. When a channel is unavailable it is left out of the rule rather than
          treated as a low value.
        </p>
        <Pairs
          rows={[
            ["Band", text(contact?.priority_band)],
            ["Score", decimal(contact?.priority_score, 3)],
            ["Inputs used", Object.keys(contact?.priority_components ?? {}).join(", ") || "None"],
            ["Recommended action", text(contact?.recommended_action)],
          ]}
        />
      </Row>

      {/* Advisory components that must never read as a verdict */}
      <Row
        name="Natural clutter (experimental)"
        value={contact?.natural_clutter?.status ? "Advisory only" : "Unavailable"}
        state="unavailable"
      >
        <p>
          The natural-clutter model was rejected as an automatic suppression gate: its false-positive
          reduction removed genuine baseline true positives as well. It is retained as experimental advisory
          provenance only and can never veto a Contact or alter detector output.
        </p>
        <Pairs
          rows={[
            ["Status", text(contact?.natural_clutter?.status)],
            ["Mode", text(contact?.natural_clutter?.mode)],
            ["Score", decimal(contact?.natural_clutter?.score, 3)],
          ]}
        />
      </Row>
    </div>
  );
}
