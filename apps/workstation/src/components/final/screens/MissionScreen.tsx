"use client";

import { Badge, Unavailable } from "../parts/Primitives";
import {
  actionSentence,
  classLabel,
  coordinates,
  countAction,
  priority,
  priorityFindings,
  reviewBadge,
} from "../runtime/select";
import { BUTTONS, TITLES, UNAVAILABLE } from "../runtime/strings";
import type { RuntimeFinding, RuntimeSurvey, Screen } from "../runtime/types";

/**
 * §5.9 Mission overview — "What requires action?". Every section answers a
 * decision, and every count derives from the record set.
 */
export function MissionScreen({
  survey,
  findings,
  processing,
  onOpen,
  onNavigate,
  closeLine,
}: {
  survey: RuntimeSurvey | null;
  findings: RuntimeFinding[];
  processing: boolean;
  onOpen: (finding: RuntimeFinding) => void;
  onNavigate: (screen: Screen) => void;
  closeLine: string;
}) {
  const backlog = countAction(findings);
  const metrics = [
    /* No coverage polygon accompanies this survey, so the surveyed fraction is
     * not computed. §6: a metric with no value renders "—", never a zero. */
    { value: "—", label: "Planned track surveyed" },
    { value: String(findings.length), label: "Findings recorded" },
    { value: String(backlog), label: "Awaiting review" },
    { value: "—", label: "New since previous pass" },
  ];

  const priority_ = priorityFindings(findings);

  return (
    <section className="sd-page sd-mission">
      <h1>{TITLES.mission}</h1>
      <p className="sd-page-sub">{closeLine}</p>

      <div className="sd-mission-metrics">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <b>{processing ? "—" : metric.value}</b>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>

      <div className="sd-mission-grid">
        <div>
          <h2 className="sd-section-heading">Priority findings</h2>
          <div style={{ marginTop: 12 }}>
            {processing ? (
              <p style={{ fontSize: 13.5, color: "var(--sd-ink-secondary)" }}>
                Findings appear as stages complete.
              </p>
            ) : priority_.length === 0 ? (
              <Unavailable title="No finding in this pass requires action.">
                Nothing recorded in this survey carries a high or review priority. That means nothing was
                detected inside the imagery that was read, not that the area is clear.
              </Unavailable>
            ) : (
              priority_.map((finding) => {
                const badge = reviewBadge(finding);
                return (
                  <button
                    key={finding.detection_id}
                    type="button"
                    className="sd-priority-row"
                    onClick={() => onOpen(finding)}
                  >
                    <div className="sd-priority-grid">
                      <div>
                        <div className="sd-priority-head">
                          <b>{classLabel(finding)}</b>
                          <Badge label={badge.label} tone={badge.tone} />
                        </div>
                        <span className="sd-priority-action">{actionSentence(finding)}</span>
                      </div>
                      <span className="sd-priority-coords sd-mono">
                        {coordinates(finding, "No position")}
                      </span>
                      <span className="sd-priority-word">{priority(finding)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <h2 className="sd-section-heading" style={{ marginTop: 34, display: "block" }}>
            Coverage and resurvey
          </h2>
          {/* §5.9: with no baseline pass the coverage block renders one row and
           * comparison is suppressed, not zeroed. */}
          <div style={{ marginTop: 12 }}>
            <Unavailable title={UNAVAILABLE.baselineTitle}>{UNAVAILABLE.baselineBody}</Unavailable>
            <button
              type="button"
              className="sd-btn-tertiary"
              style={{ marginTop: 8 }}
              onClick={() => onNavigate("change")}
            >
              What a resurvey comparison would need
            </button>
          </div>
        </div>

        <aside className="sd-mission-aside">
          <div>
            <h2>Review backlog</h2>
            <div className="sd-backlog">
              <b>{processing ? "—" : String(backlog)}</b>
              <span>findings awaiting an analyst decision</span>
              <button
                type="button"
                className="sd-btn-secondary"
                onClick={() => onNavigate("review")}
              >
                {BUTTONS.openQueue}
              </button>
            </div>
          </div>
          <div>
            <h2>Team</h2>
            {/* Bind to real assignment data; render the unavailable state rather
             * than placeholder people. */}
            <Unavailable title={UNAVAILABLE.teamTitle}>{UNAVAILABLE.teamBody}</Unavailable>
          </div>
          <button
            type="button"
            className="sd-btn-primary"
            disabled={!survey}
            onClick={() => onNavigate("report")}
          >
            {BUTTONS.generateReport}
          </button>
        </aside>
      </div>
    </section>
  );
}
