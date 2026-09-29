import { useState } from "react";
import type { Contact, Evidence as Ev, EvidenceKey, Priority, ReviewDecision } from "../api/types";
import { contactName, isReviewed, useStore } from "../state/store";
import { analystLabel, AVAILABILITY_LABEL, CLASS_LABEL, displayName, EVIDENCE_LABEL, methodLabel, PRIORITY_LABEL, shortTime } from "../api/labels";
import { confidenceText, DemoTag, Icon, Kbd, StateChip, StateGlyph, StatusMark } from "../components/ui";

export function Inspector({ contact }: { contact: Contact }) {
  const { state, imagery } = useStore();
  const survey = state.surveys.find((s) => contact.survey_refs.includes(s.survey_ref));
  const img = imagery(contact);
  return (
    <aside className="insp" aria-label={`Evidence for ${contactName(contact)}`} key={contact.contact_id} aria-busy={state.pending === contact.contact_id}>
      <header className="insp__head">
        <div className="insp__title">
          <h2>{contactName(contact)}</h2>
          <StatusMark status={contact.analyst.status} />
        </div>
        <p className="insp__meta">
          {survey ? displayName(survey.name, survey.survey_ref) : "Survey unavailable"}
          {img?.label ? ` · ${img.label}` : ""}
          {contact.demo && <DemoTag />}
        </p>
      </header>

      <div className="insp__scroll">
        <Machine contact={contact} />
        <Evidence contact={contact} />
      </div>

      {/* The decision stays in view while evidence scrolls above it. */}
      <Analyst contact={contact} />
      <NextBar />
    </aside>
  );
}

/* ---------------- Machine ---------------- */

function Machine({ contact }: { contact: Contact }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const m = contact.machine;
  const anomalyCap = state.capabilities?.local_anomaly;
  const anomalyState = contact.evidence.local_anomaly?.status ?? anomalyCap?.availability ?? "UNAVAILABLE";
  const shipwreck = state.capabilities?.shipwreck_supervised;
  return (
    <section className="insp__sec" aria-labelledby={`m-${contact.contact_id}`}>
      <p className="insp__eyebrow" id={`m-${contact.contact_id}`}>
        <span className="who who--machine">Machine</span> assessment
      </p>
      {m ? (
        <>
          <div className="machine">
            <div>
              <p className="machine__class">{CLASS_LABEL[m.supervised_class]}</p>
              <p className="machine__code">{m.supervised_class}</p>
            </div>
            <div className="machine__score">
              <span className="machine__score-label">
                Confidence {m.demo && <DemoTag>Fixture value</DemoTag>}
              </span>
              <span className="machine__score-value">{confidenceText(contact) ?? m.raw_detector_score.toFixed(2)}</span>
            </div>
          </div>
          <p className="insp__note">Confidence from this Contact's evidence. Not a calibrated probability.</p>
          <details className="insp__tech">
            <summary>Technical details</summary>
            <dl>
              <div>
                <dt>Raw detector score</dt>
                <dd className="mono">{m.raw_detector_score.toFixed(4)}</dd>
              </div>
              {m.raw_fused_confidence != null && (
                <div>
                  <dt>Fused evidence</dt>
                  <dd className="mono">{m.raw_fused_confidence.toFixed(4)}</dd>
                </div>
              )}
              {m.display_confidence_method && (
                <div>
                  <dt>Display method</dt>
                  <dd className="mono">{m.display_confidence_method}</dd>
                </div>
              )}
            </dl>
          </details>
          {m.supervised_class === "SHIPWRECK" && shipwreck?.availability === "FAILED" && (
            <p className="caveat">
              <Icon name="info" size={14} />
              Supervised Shipwreck detection failed held-out evaluation. Treat this as a proposal only.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="machine">
            <div>
              <p className="machine__class">Local anomaly</p>
              <p className="machine__sub">No supervised identity</p>
            </div>
            <StateChip state={anomalyState} />
          </div>
          <p className="insp__note">Unusual relative to comparable seabed. Unusual is not the same as artificial.</p>
          <button className="disclose" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <Icon name={open ? "chevronDown" : "chevronRight"} size={12} /> How it is compared
          </button>
          {open && (
            <div className="compare">
              <svg viewBox="0 0 240 96" className="compare__fig" aria-hidden="true">
                <rect x="0" y="0" width="240" height="96" className="compare__bg" />
                <line x1="120" x2="120" y1="0" y2="96" className="compare__nadir" />
                <rect x="170" y="0" width="30" height="30" className="compare__ref" />
                <rect x="170" y="66" width="30" height="30" className="compare__ref" />
                <line x1="160" x2="210" y1="34" y2="34" className="compare__guard" />
                <line x1="160" x2="210" y1="62" y2="62" className="compare__guard" />
                <rect x="177" y="40" width="16" height="16" className="compare__cand" />
              </svg>
              <ul className="compare__list">
                <li>Same Survey</li>
                <li>Same side of the sonar</li>
                <li>Comparable slant range</li>
                <li>The candidate's own pings set aside</li>
              </ul>
              <p className="insp__note">{anomalyCap?.reason ?? "The method is in validation."} No significance value is shown until it passes.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ---------------- Evidence ---------------- */

const ROWS: EvidenceKey[] = ["detector", "local_anomaly", "persistence", "raised_relief", "navigation"];

/** One plain sentence per channel, derived from the backend's own status and provenance. */
function summary(key: EvidenceKey, ev: Ev, contact: Contact): string {
  const synthetic = ev.provenance === "SYNTHETIC_DEMO";
  if (ev.status === "FAILED") return "The check failed on the service.";
  switch (key) {
    case "detector":
      if (ev.status !== "AVAILABLE") return contact.machine ? "No supervised observation attached." : "Not proposed by the detector.";
      return synthetic ? "Fixture detector output. No inference was run for this demo." : "Proposed by the frozen detector.";
    case "local_anomaly":
      return ev.status === "NOT_VALIDATED" ? "Not yet validated. No significance value is reported." : ev.status === "AVAILABLE" ? "Unusual relative to comparable seabed." : "Not evaluated.";
    case "persistence":
      return ev.status === "AVAILABLE" ? `${contact.look_count} independent Looks.` : `Seen in ${contact.look_count} Look. A second needs a repeated physical observation.`;
    case "raised_relief":
      return ev.status === "AVAILABLE" ? "Acoustic shadow supports raised relief. Not artificiality, and no metric height." : "No validated relief measurement.";
    case "navigation":
      if (synthetic) return "Synthetic demo position. For orientation only, never evidence.";
      return ev.status === "AVAILABLE" ? "Contact position available." : "No Contact position. Navigation locates the platform, not the Contact.";
    default:
      return AVAILABILITY_LABEL[ev.status];
  }
}

function Evidence({ contact }: { contact: Contact }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = ROWS.filter((k) => contact.evidence[k]);
  const available = rows.filter((k) => contact.evidence[k].status === "AVAILABLE" && contact.evidence[k].provenance !== "SYNTHETIC_DEMO").length;
  return (
    <section className="insp__sec">
      <p className="insp__eyebrow">
        Evidence <span className="insp__count">{available} of {rows.length} measured</span>
      </p>
      <ul className="evidence">
        {rows.map((key) => {
          const ev = contact.evidence[key];
          const synthetic = ev.provenance === "SYNTHETIC_DEMO";
          const isOpen = open === key;
          return (
            <li key={key} className={`ev ev--${ev.status.toLowerCase()} ${synthetic ? "ev--synthetic" : ""}`}>
              <button className="ev__row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
                <StateGlyph state={synthetic ? "NOT_VALIDATED" : ev.status} />
                <span className="ev__name">{EVIDENCE_LABEL[key]}</span>
                <span className="ev__state">{synthetic ? "Synthetic demo" : AVAILABILITY_LABEL[ev.status]}</span>
                <Icon name={isOpen ? "chevronDown" : "chevronRight"} size={12} />
              </button>
              <p className="ev__summary">{summary(key, ev, contact)}</p>
              {isOpen && (
                <dl className="ev__more">
                  <div>
                    <dt>Method</dt>
                    <dd>{methodLabel(ev.method)}</dd>
                  </div>
                  <div>
                    <dt>Provenance</dt>
                    <dd>{ev.provenance ?? "None recorded"}</dd>
                  </div>
                  {ev.reason && (
                    <div>
                      <dt>Reason</dt>
                      <dd>{ev.reason}</dd>
                    </div>
                  )}
                  {key === "persistence" && (
                    <div>
                      <dt>Looks</dt>
                      <dd>
                        {contact.look_count} · {contact.association_basis.toLowerCase().replace(/_/g, " ")}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Recorded</dt>
                    <dd>{shortTime(ev.timestamp)}</dd>
                  </div>
                </dl>
              )}
            </li>
          );
        })}
      </ul>
      <p className="insp__note">Missing evidence is never counted against a Contact. Metric depth and height are not available.</p>
    </section>
  );
}

/* ---------------- Analyst ---------------- */

function Analyst({ contact }: { contact: Contact }) {
  const { state, dispatch, decide, setPriority } = useStore();
  const a = contact.analyst;
  const reviewed = isReviewed(contact);
  const busy = state.pending === contact.contact_id;
  const last = contact.history[contact.history.length - 1];
  const lastNote = [...contact.history].reverse().find((e) => e.note && e.action === "notes");
  const classified = a.classification !== "UNRESOLVED" || reviewed;
  const decideBtn = (status: ReviewDecision, label: string, key: string, icon?: string) => (
    <button className={`decide__btn ${a.status === status ? "is-on" : ""}`} onClick={() => void decide(contact.contact_id, status)} disabled={busy} aria-pressed={a.status === status}>
      {icon && <Icon name={icon} size={14} />} {label} <Kbd>{key}</Kbd>
    </button>
  );
  return (
    <section className="insp__analyst" aria-label="Analyst verdict">
      <p className="insp__eyebrow">
        <span className="who who--analyst">Analyst</span> verdict
      </p>

      <div className="decide" role="group" aria-label="Verdict">
        {decideBtn("CONFIRMED", "Confirm", "1", "check")}
        {decideBtn("REJECTED", "Reject", "2", "close")}
        {decideBtn("UNRESOLVED", "Unresolved", "3")}
      </div>

      {classified && a.classification !== "UNRESOLVED" ? (
        <div className="verdict">
          <div className="verdict__main">
            <p className="verdict__label">Analyst classification</p>
            <p className="verdict__value">{analystLabel(a.classification)}</p>
            <p className="verdict__prov">
              {last ? `${last.actor === "DEMO_FIXTURE" ? "Demo fixture" : last.actor} · ${shortTime(last.timestamp)} · ${contact.history.length} history entr${contact.history.length === 1 ? "y" : "ies"}` : "Recorded"}
            </p>
          </div>
          <button className="btn btn--quiet" onClick={() => dispatch({ type: "modal", modal: "classify" })} disabled={busy}>
            Change <Kbd>C</Kbd>
          </button>
        </div>
      ) : (
        <button className="classify" onClick={() => dispatch({ type: "modal", modal: "classify" })} disabled={busy}>
          <Icon name="tag" size={14} />
          <span>Classify Contact</span>
          <span className="classify__hint">Analyst taxonomy</span>
          <Kbd>C</Kbd>
        </button>
      )}

      <div className="prio">
        <span className="prio__label">Priority</span>
        <div className="seg" role="radiogroup" aria-label="Analyst priority">
          {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as Priority[]).map((p) => (
            <button key={p} role="radio" aria-checked={a.priority === p} className={a.priority === p ? "is-on" : ""} onClick={() => void setPriority(contact.contact_id, a.priority === p ? "UNSET" : p)} disabled={busy}>
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      <p className="prio__system">Set by the analyst. The system does not rank Contacts.</p>

      {lastNote && (
        <blockquote className="notes__last">
          <span>“{lastNote.note}”</span>
          <cite>
            {lastNote.actor} · {shortTime(lastNote.timestamp)}
          </cite>
        </blockquote>
      )}
      <div className="analyst__links">
        <button className="link" onClick={() => dispatch({ type: "modal", modal: "note" })} disabled={busy}>
          <Icon name="note" size={14} /> Add note <Kbd>N</Kbd>
        </button>
        {contact.history.length > 0 && (
          <button className="link" onClick={() => dispatch({ type: "modal", modal: "history" })}>
            <Icon name="history" size={14} /> History <Kbd>H</Kbd>
          </button>
        )}
      </div>
    </section>
  );
}

function NextBar() {
  const { queue, next, selected } = useStore();
  const awaiting = queue.filter((c) => !isReviewed(c));
  const decided = !!selected && isReviewed(selected);
  return (
    <footer className="insp__foot">
      <span className="insp__progress">{awaiting.length === 0 ? "Queue complete" : `${awaiting.length} awaiting review`}</span>
      <button className={`btn ${decided ? "btn--primary" : ""}`} onClick={next}>
        Next Contact <Kbd>{decided ? "↵" : "J"}</Kbd>
      </button>
    </footer>
  );
}
