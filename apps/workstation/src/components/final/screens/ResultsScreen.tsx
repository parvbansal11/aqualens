"use client";

import { useState } from "react";
import { Badge, CompleteLine, Unavailable } from "../parts/Primitives";
import {
  confidenceFraction,
  confidenceLabel,
  coordinates,
  countContactsAwaiting,
  countOpenSetCandidates,
  countPositioned,
  classLabel,
  evidenceBandLabel,
  evidenceScoreLabel,
  priority,
  reviewBadge,
  sortedFindings,
  whereLine,
  type ContactView,
} from "../runtime/select";
import { BUTTONS, CAVEATS, COPY } from "../runtime/strings";
import type { RuntimeFinding, RuntimeSurvey, RuntimeSurveySummary, Screen } from "../runtime/types";

type Scope = "contacts" | "observations";

const SCOPES: readonly (readonly [Scope, string])[] = [
  ["contacts", "Contacts"],
  ["observations", "Raw observations"],
];

/**
 * §5.5 Results — "What did we find?".
 *
 * The Contact is the operational object and the list defaults to it. The raw
 * detector observations stay one control away, labelled as evidence beneath a
 * Contact rather than as a second, competing answer. Every metric derives from
 * the record set; none is a sent scalar.
 */
export function ResultsScreen({
  contacts,
  findings,
  survey,
  loading,
  error,
  recent,
  onOpenRecent,
  onOpen,
  onNavigate,
  onRetry,
  onUpload,
  title,
}: {
  contacts: ContactView[];
  findings: RuntimeFinding[];
  survey: RuntimeSurvey | null;
  loading: boolean;
  error: { message: string; retryable: boolean } | null;
  recent: RuntimeSurveySummary[];
  onOpenRecent: (id: string) => void;
  onOpen: (finding: RuntimeFinding) => void;
  onNavigate: (screen: Screen) => void;
  onRetry: () => void;
  onUpload: () => void;
  title: string;
}) {
  const [scope, setScope] = useState<Scope>("contacts");
  /* A survey can produce observations the fusion policy did not associate into
   * any Contact. The scope then resolves to observations rather than leaving a
   * disabled tab looking selected over a list it is not showing. */
  const contactsAvailable = contacts.length > 0;
  const activeScope: Scope = contactsAvailable ? scope : "observations";
  const showContacts = activeScope === "contacts";

  const metrics = [
    { value: contacts.length, label: "Contacts" },
    { value: countContactsAwaiting(contacts), label: "Awaiting a decision" },
    { value: countOpenSetCandidates(contacts), label: "Open-set candidates" },
    { value: findings.length - countPositioned(findings), label: "Observations without a position" },
  ];

  return (
    <section className="sd-page sd-results">
      <CompleteLine ready={!loading && !error}>
        {loading ? "Loading survey" : error ? "Survey could not be loaded" : COPY.resultsComplete}
      </CompleteLine>
      <h1>{title}</h1>

      <div className="sd-metric-row">
        {metrics.map((metric) => (
          <div key={metric.label}>
            {/* §6: a metric renders "—" while loading. Never a substituted zero. */}
            <b>{loading || error ? "—" : String(metric.value)}</b>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>

      <div className="sd-list-head">
        <h2>{showContacts ? "Contacts" : "Raw detector observations"}</h2>
        <span>{showContacts ? COPY.contactsHint : COPY.observationsHint}</span>
        <div className="sd-seg sd-seg-inline" role="tablist" aria-label="Result scope">
          {SCOPES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeScope === id}
              aria-controls="sd-result-list"
              disabled={id === "contacts" && !contactsAvailable}
              title={
                id === "contacts" && !contactsAvailable
                  ? "The fusion policy associated no observation in this survey into a Contact."
                  : undefined
              }
              onClick={() => setScope(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <a
          href="#"
          onClick={(event) => {
            event.preventDefault();
            onNavigate("map");
          }}
        >
          {BUTTONS.showOnMap}
        </a>
      </div>

      <div
        className="sd-findings"
        id="sd-result-list"
        role="tabpanel"
        aria-label={showContacts ? "Contacts" : "Raw detector observations"}
      >
        {loading ? (
          /* §5.5 loading: plain grey blocks at the exact row height, no shimmer. */
          Array.from({ length: 6 }, (_, index) => <div className="sd-skeleton-row" key={index} />)
        ) : error ? (
          <div style={{ marginTop: 12 }}>
            <Unavailable title="This survey could not be loaded">{error.message}</Unavailable>
            <div className="sd-action-row" style={{ marginTop: 12 }}>
              {error.retryable ? (
                <button type="button" className="sd-btn-secondary" onClick={onRetry}>
                  {BUTTONS.retry}
                </button>
              ) : null}
              <button type="button" className="sd-btn-secondary" onClick={onUpload}>
                {BUTTONS.uploadNewSurvey}
              </button>
            </div>
            <RecoverySurveys recent={recent} activeId={survey?.survey_id ?? null} onOpenRecent={onOpenRecent} />
          </div>
        ) : findings.length === 0 ? (
          <div style={{ marginTop: 12 }}>
            <Unavailable title="No findings recorded in this pass." className="sd-empty">
              {CAVEATS.emptyFindings}
            </Unavailable>
            <div className="sd-action-row" style={{ marginTop: 12 }}>
              <button type="button" className="sd-btn-secondary" onClick={onUpload}>
                {BUTTONS.uploadNewSurvey}
              </button>
            </div>
            <RecoverySurveys recent={recent} activeId={survey?.survey_id ?? null} onOpenRecent={onOpenRecent} />
          </div>
        ) : showContacts ? (
          contacts.map((view) => (
            <button
              key={view.contact.contact_id}
              type="button"
              className="sd-finding-row"
              data-contact-id={view.contact.contact_id}
              onClick={() => onOpen(view.best)}
            >
              <div className="sd-contact-grid">
                <div style={{ minWidth: 0 }}>
                  <div className="sd-finding-head">
                    <b>{view.label}</b>
                    <Badge label={view.badge.label} tone={view.badge.tone} />
                    {view.openSetCandidate ? <Badge label="Open-set candidate" tone="accent" /> : null}
                  </div>
                  <span className="sd-finding-where sd-mono">
                    {`${view.contact.contact_id} · ${view.observationCount} observation${view.observationCount === 1 ? "" : "s"} across ${view.frameCount} frame${view.frameCount === 1 ? "" : "s"}`}
                  </span>
                </div>
                <span className="sd-finding-coords sd-mono">
                  {view.positioned
                    ? `${view.contact.latitude?.toFixed(4)}° N, ${view.contact.longitude?.toFixed(4)}° E`
                    : "No position"}
                </span>
                <span className="sd-finding-conf">
                  Evidence score {evidenceScoreLabel(view.evidenceScore)}
                </span>
                <span className="sd-finding-priority" data-high={evidenceBandLabel(view.contact) === "High"}>
                  {evidenceBandLabel(view.contact)}
                </span>
                <span className="sd-finding-chevron" aria-hidden="true">›</span>
              </div>
            </button>
          ))
        ) : (
          sortedFindings(findings).map((finding) => {
            const badge = reviewBadge(finding);
            const level = priority(finding);
            return (
              <button
                key={finding.detection_id}
                type="button"
                className="sd-finding-row"
                onClick={() => onOpen(finding)}
              >
                <div className="sd-finding-grid">
                  <div style={{ minWidth: 0 }}>
                    <div className="sd-finding-head">
                      <b>{classLabel(finding)}</b>
                      <Badge label={badge.label} tone={badge.tone} />
                    </div>
                    <span className="sd-finding-where">{whereLine(finding)}</span>
                  </div>
                  <span className="sd-finding-coords sd-mono">
                    {coordinates(finding, "No position")}
                  </span>
                  <div>
                    <span className="sd-finding-conf">
                      Raw confidence {confidenceLabel(finding.raw_confidence)}
                    </span>
                    <span className="sd-conf-track">
                      <i style={{ width: `${confidenceFraction(finding.raw_confidence) * 100}%` }} />
                    </span>
                  </div>
                  <span className="sd-finding-priority" data-high={level === "High"}>
                    {level}
                  </span>
                  <span className="sd-finding-chevron" aria-hidden="true">›</span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {findings.length > 0 && !loading && !error ? (
        <p className="sd-results-note">
          {showContacts ? COPY.contactsNote : COPY.observationsNote}
        </p>
      ) : null}

      <div className="sd-action-row">
        <button type="button" className="sd-btn-primary" onClick={() => onNavigate("report")}>
          {BUTTONS.downloadReport}
        </button>
        <button type="button" className="sd-btn-secondary" onClick={() => onNavigate("review")}>
          {BUTTONS.startReview}
        </button>
      </div>
    </section>
  );
}

/** Reconnect affordance: a survey this deployment still holds can be reopened. */
function RecoverySurveys({
  recent,
  activeId,
  onOpenRecent,
}: {
  recent: RuntimeSurveySummary[];
  activeId: string | null;
  onOpenRecent: (id: string) => void;
}) {
  const others = recent.filter((item) => item.survey_id !== activeId).slice(0, 5);
  if (others.length === 0) return null;
  return (
    <div className="sd-recovery">
      <h3 className="sd-eyebrow sd-eyebrow-md">Surveys this service still holds</h3>
      <div className="sd-recovery-list">
        {others.map((item) => (
          <button key={item.survey_id} type="button" onClick={() => onOpenRecent(item.survey_id)}>
            <b>{item.name}</b>
            <span className="sd-mono">
              {`${item.contact_count} contact${item.contact_count === 1 ? "" : "s"} · ${item.finding_count} observation${item.finding_count === 1 ? "" : "s"} · ${item.navigation_status === "AVAILABLE" ? "navigation supplied" : "no navigation"}`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
