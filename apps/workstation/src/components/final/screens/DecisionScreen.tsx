"use client";

import {
  awaitingDecision,
  countAction,
  countConfirmed,
  countImportant,
  countPositioned,
  sector,
  surveyTimestamp,
} from "../runtime/select";
import { BUTTONS, CAVEATS } from "../runtime/strings";
import type { RuntimeSurvey, Screen } from "../runtime/types";

type Tone = "ok" | "warn" | "null" | null;

function listSectors(names: string[]): string {
  const unique = Array.from(new Set(names));
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  if (unique.length === 3) return `${unique[0]}, ${unique[1]} and ${unique[2]}`;
  return `${unique.length} source frames`;
}

/**
 * §5.10 Decision view — "What requires attention?". The simplest screen in the
 * product. All five metrics derive. The recommended-action panel and its "Why?"
 * disclosure carry no metric, method name or score.
 */
export function DecisionScreen({
  survey,
  processing,
  onNavigate,
  why,
  onToggleWhy,
}: {
  survey: RuntimeSurvey | null;
  processing: boolean;
  onNavigate: (screen: Screen) => void;
  why: boolean;
  onToggleWhy: () => void;
}) {
  const findings = survey?.findings ?? [];
  const backlog = countAction(findings);
  const confirmed = countConfirmed(findings);
  const important = countImportant(findings);
  const waitingSectors = listSectors(findings.filter(awaitingDecision).map(sector));

  const rows = processing
    ? [
        { label: "Survey status", value: "In progress", tone: null as Tone, toneLabel: "" },
        { label: "Important findings", value: "—", tone: null as Tone, toneLabel: "" },
        { label: "Requires action", value: "—", tone: null as Tone, toneLabel: "" },
        { label: "New since previous pass", value: "—", tone: null as Tone, toneLabel: "" },
        { label: "Confirmed hazards", value: "—", tone: null as Tone, toneLabel: "" },
      ]
    : [
        {
          label: "Survey status",
          value: survey ? "Completed" : "No survey",
          tone: (survey ? "ok" : null) as Tone,
          toneLabel: survey
            ? `All ${survey.frames.length} source ${survey.frames.length === 1 ? "frame" : "frames"} processed`
            : "",
        },
        { label: "Important findings", value: String(important), tone: null as Tone, toneLabel: "" },
        {
          label: "Requires action",
          value: String(backlog),
          tone: (backlog > 0 ? "warn" : null) as Tone,
          toneLabel: backlog > 0 ? waitingSectors : "",
        },
        {
          label: "New since previous pass",
          value: "—",
          tone: "null" as Tone,
          toneLabel: "No previous pass",
        },
        { label: "Confirmed hazards", value: String(confirmed), tone: null as Tone, toneLabel: "" },
      ];

  let action: string;
  let line: string;
  if (processing) {
    action = "No recommendation until the survey completes.";
    line = "The recommendation appears once every stage of the run has passed.";
  } else if (findings.length === 0) {
    action = "No finding in this pass requires action.";
    line = CAVEATS.emptyFindings;
  } else if (backlog > 0) {
    action = "Have an analyst review this survey before any recovery planning.";
    line = `Findings in ${waitingSectors} are still awaiting an analyst decision, so none of them can be treated as a confirmed hazard yet.`;
  } else if (confirmed > 0) {
    action = "Enter the confirmed findings in the hazard register and plan an inspection.";
    line = "Every finding in this survey has been decided, and some were confirmed as real.";
  } else {
    action = "No further action is needed before the next scheduled pass.";
    line = "Every finding in this survey has been decided, and none was confirmed as a hazard.";
  }

  /* §7.2 applies to prose too: the navigation sentence is bound to what this
   * survey actually carries, never fixed at authoring time. */
  const positioned = countPositioned(findings);
  const navigationSentence =
    positioned === 0
      ? "No finding in this survey carries a latitude and longitude, because no navigation record was supplied with it. No area can be declared surveyed or unsurveyed, and absence here is not a removal."
      : `${positioned} of ${findings.length} findings carry a latitude and longitude copied from supplied navigation records. No coverage polygon accompanies this survey, so no area can be declared surveyed or unsurveyed, and absence here is not a removal.`;

  const whyRows = [
    findings.length === 0
      ? "This survey produced no finding records. Nothing was separated from the seabed inside the imagery that was read."
      : `This survey produced ${findings.length} finding ${findings.length === 1 ? "record" : "records"} from the sonar imagery that was read. Each one is a shape the system separated from the seabed, not a confirmed object.`,
    backlog > 0
      ? "None of the undecided findings has been reviewed by an analyst, so none can be treated as a confirmed hazard yet."
      : "Every finding has been through an analyst decision, so the register reflects a reviewed position.",
    navigationSentence,
  ];

  return (
    <section className="sd-page sd-decision">
      <p className="sd-decision-eyebrow">Today&apos;s survey</p>
      <h1>{survey ? survey.name : "No survey loaded"}</h1>
      <p className="sd-decision-context">
        {survey
          ? `${survey.frames.length} source ${survey.frames.length === 1 ? "frame" : "frames"} examined. Processed ${surveyTimestamp(survey)}.`
          : "Upload a supported sonar raster to begin."}
      </p>

      <div className="sd-decision-grid">
        {rows.map((row) => (
          <div className="sd-decision-row" key={row.label}>
            <span>{row.label}</span>
            <div className="sd-decision-value">
              <b>{row.value}</b>
              {row.tone && row.toneLabel ? (
                <span className="sd-decision-tone" data-tone={row.tone}>
                  {row.toneLabel}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="sd-recommend">
        <p className="sd-recommend-eyebrow">Recommended action</p>
        <p className="sd-recommend-action">{action}</p>
        <p className="sd-recommend-line">{line}</p>
        <button type="button" aria-expanded={why} onClick={onToggleWhy}>
          {why ? BUTTONS.whyClose : BUTTONS.why}
        </button>
        {why ? (
          <div className="sd-recommend-why">
            {whyRows.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
        ) : null}
      </div>

      <div className="sd-decision-actions">
        <button type="button" className="sd-btn-primary" onClick={() => onNavigate("results")}>
          {BUTTONS.viewFindings}
        </button>
        <button
          type="button"
          className="sd-btn-secondary"
          disabled={!survey}
          onClick={() => onNavigate("report")}
        >
          {BUTTONS.downloadReport}
        </button>
      </div>
    </section>
  );
}
