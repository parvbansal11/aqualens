import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Check, X, CircleHelp } from "lucide-react";
import { useWorkspace } from "../lib/store";
import { appendReview } from "../lib/runtime/api";
import {
  representative,
  sortedContacts,
  reviewedCount,
  score,
  roles,
  coordinate,
  contactMetric,
} from "../lib/runtime/selectors";
import type { Verdict } from "../lib/runtime/wire";
import {
  SectionHeading,
  Status,
  IllustrativeNote,
  Empty,
} from "../components/ui";
export default function Review() {
  const { survey } = useWorkspace();
  const { contactId } = useParams();
  return <ReviewSurface key={`${survey?.id}/${contactId ?? "queue"}`} />;
}
function ReviewSurface() {
  const { survey, role, openSurvey, connection } = useWorkspace();
  const { contactId } = useParams();
  const [filter, setFilter] = useState("pending"),
    [verdict, setVerdict] = useState<Verdict | null>(null),
    [notes, setNotes] = useState(""),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  if (!survey) return null;
  const contact = survey.contacts.find((c) => c.id === contactId),
    demo = survey.source === "PRESENTATION",
    metric = contact ? contactMetric(contact) : null;
  const observation = contact && representative(contact, survey.observations),
    frame = survey.frames.find((f) => f.id === observation?.frameId);
  const pending = (state: string) => ["PENDING", "UNCERTAIN"].includes(state);
  async function save() {
    if (!survey || !contact || !observation || !verdict || saving) return;
    setError("");
    setMessage("");
    if (demo) {
      setMessage("Preview decision only. No review event was saved.");
      return;
    }
    setSaving(true);
    let recorded = false;
    try {
      await appendReview(
        survey.id,
        observation.id,
        verdict,
        roles.find((r) => r.id === role)!.name,
        notes,
      );
      recorded = true;
      const refreshed = await openSurvey(survey.id);
      setMessage(
        refreshed
          ? "Decision recorded in append-only Review Memory."
          : "Decision recorded. Reopen the survey to refresh its review state.",
      );
      setVerdict(null);
      setNotes("");
    } catch (e) {
      setError(
        recorded
          ? "Decision recorded. Refresh the survey before submitting another decision."
          : e instanceof Error
            ? e.message
            : "The review could not be confirmed.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <main id="main-content" className="workspace-main review-page">
      <SectionHeading
        eyebrow="REVIEW / HUMAN DECISION"
        title={
          contact ? "Make the record clear." : "A decision for every Contact."
        }
      >
        {!contact && (
          <span className="quiet-count">
            {reviewedCount(survey)} of {survey.contacts.length} reviewed
          </span>
        )}
      </SectionHeading>
      {demo && <IllustrativeNote />}
      {!contact ? (
        <>
          <div className="results-tools">
            <div className="segmented">
              <button
                aria-pressed={filter === "pending"}
                onClick={() => setFilter("pending")}
              >
                Needs review
              </button>
              <button
                aria-pressed={filter === "reviewed"}
                onClick={() => setFilter("reviewed")}
              >
                Reviewed
              </button>
            </div>
            <Link className="text-link" to="/workspace/report">
              Survey Report
              <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="review-queue">
            {sortedContacts(survey)
              .filter((c) => pending(c.review) === (filter === "pending"))
              .map((c) => {
                const o = representative(c, survey.observations),
                  f = survey.frames.find((f) => f.id === o?.frameId),
                  metric = contactMetric(c);
                return (
                  <Link
                    className="queue-row"
                    key={c.id}
                    to={`/workspace/review/${encodeURIComponent(c.id)}`}
                  >
                    <img src={f?.image} alt={`${c.shortId} sonar preview`} />
                    <div>
                      <span className="mono">{c.shortId}</span>
                      <h2>{c.label}</h2>
                      <p>
                        {c.observationIds.length} observations
                        {c.priority
                          ? ` · ${c.priority.toLowerCase()} priority`
                          : ""}
                      </p>
                    </div>
                    {metric.value !== null && (
                      <span className="queue-evidence">
                        {metric.label}
                        <strong>{score(metric.value)}</strong>
                      </span>
                    )}
                    <Status value={c.review} />
                    <ArrowUpRight size={19} />
                  </Link>
                );
              })}
          </div>
          {!survey.contacts.some(
            (c) => pending(c.review) === (filter === "pending"),
          ) && (
            <Empty
              title={
                filter === "pending"
                  ? "The review queue is clear."
                  : "No reviewed Contacts yet."
              }
            />
          )}
        </>
      ) : (
        <>
          <Link className="text-link back-link" to="/workspace/review">
            <ArrowLeft size={15} />
            Review queue
          </Link>
          <div className="review-desk">
            <section className="review-visual">
              <div>
                <span className="mono">{contact.shortId}</span>
                <h2>{contact.label}</h2>
                <Status value={contact.review} />
              </div>
              {frame && (
                <img
                  src={frame.image}
                  alt={`Representative sonar for ${contact.label}`}
                />
              )}
              <footer>
                <span>{contact.observationIds.length} source observations</span>
                {role === "analyst" && (
                  <Link
                    to={`/workspace/contact/${contact.id}`}
                    className="text-link"
                  >
                    Inspect all evidence
                    <ArrowUpRight size={14} />
                  </Link>
                )}
              </footer>
            </section>
            <section className="decision-panel" aria-label="Review decision">
              <p className="eyebrow">YOUR ASSESSMENT</p>
              {metric && metric.value !== null && (
                <div className="decision-evidence">
                  <span>{metric.label}</span>
                  <strong>{score(metric.value)}</strong>
                </div>
              )}
              {contact.position && (
                <p className="mono">
                  {coordinate(contact.position.lat, true)}
                  <br />
                  {coordinate(contact.position.lon, false)}
                </p>
              )}
              <div className="decision-options">
                {(
                  [
                    ["CONFIRMED", "Confirm", Check],
                    ["REJECTED", "Reject", X],
                    ["UNCERTAIN", "Needs review", CircleHelp],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    aria-pressed={verdict === value}
                    onClick={() => setVerdict(value)}
                  >
                    <Icon size={18} />
                    {label}
                  </button>
                ))}
              </div>
              <label className="field-label">
                Notes <span>optional</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="What informed this decision?"
                />
              </label>
              <button
                className="button"
                disabled={
                  !verdict ||
                  saving ||
                  (!demo && connection !== "Service connected")
                }
                onClick={() => void save()}
              >
                {saving
                  ? "Recording decision…"
                  : demo
                    ? "Preview decision"
                    : "Record decision"}
                <ArrowUpRight size={16} />
              </button>
              <p className="decision-consequence">
                {demo
                  ? "Preview only. Decisions are not saved."
                  : "Review is recorded in append-only memory."}
              </p>
              {message && (
                <p role="status" className="decision-message">
                  {message}
                </p>
              )}
              {error && (
                <p role="alert" className="error-message">
                  {error}
                </p>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
