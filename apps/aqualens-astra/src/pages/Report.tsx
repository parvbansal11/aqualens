import { Download, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../lib/store";
import { configured, reportUrl, type RuntimeReport } from "../lib/runtime/api";
import { useRemote } from "../lib/runtime/useRemote";
import {
  reviewedCount,
  score,
  capabilities,
  contactMetric,
} from "../lib/runtime/selectors";
import { SectionHeading, Status, IllustrativeNote } from "../components/ui";
import SurveyMap from "../components/SurveyMap";
export default function Report() {
  const { survey, role } = useWorkspace();
  const real = survey?.source === "RUNTIME";
  const record = useRemote<RuntimeReport>(
    real && configured
      ? `/runtime/surveys/${encodeURIComponent(survey.id)}/report?format=json`
      : null,
  );
  if (!survey) return null;
  return (
    <main id="main-content" className="workspace-main report-page">
      <SectionHeading eyebrow="MISSION DOSSIER" title="Survey Report">
        <span className="dossier-id mono">
          {real ? (survey.mission ?? survey.id) : "ILLUSTRATIVE SURVEY"}
        </span>
      </SectionHeading>
      <div className="dossier-heading">
        <div>
          <h2>{survey.name}</h2>
          {record.data?.provenance.generated_at && (
            <p>
              Generated{" "}
              <time dateTime={record.data.provenance.generated_at}>
                {new Date(record.data.provenance.generated_at).toLocaleString()}
              </time>
            </p>
          )}
        </div>
        {!real && <IllustrativeNote />}
      </div>
      <div className="dossier-counts">
        <div>
          <strong>{survey.contacts.length}</strong>
          <span>Contacts</span>
        </div>
        <div>
          <strong>{survey.observations.length}</strong>
          <span>Observations</span>
        </div>
        <div>
          <strong>{survey.frames.length}</strong>
          <span>Frames</span>
        </div>
        <div>
          <strong>
            {reviewedCount(survey)} / {survey.contacts.length}
          </strong>
          <span>Reviewed</span>
        </div>
      </div>
      {capabilities(survey).navigation && (
        <section className="report-map">
          <SurveyMap survey={survey} preview />
          {role !== "decision" && (
            <Link
              className="report-map-link button button-secondary"
              to="/workspace/map"
            >
              Open survey map
              <ArrowUpRight size={16} />
            </Link>
          )}
        </section>
      )}
      <section className="dossier-contacts">
        <div className="row-heading">
          <h2>Contact record</h2>
          <span>{real ? "RUNTIME EVIDENCE" : "ILLUSTRATIVE EVIDENCE"}</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Classification</th>
                <th>Observations</th>
                <th>
                  {survey.contacts.some((c) => c.confidence !== null)
                    ? "Confidence"
                    : "Evidence"}
                </th>
                <th>Priority</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {survey.contacts.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.shortId}</td>
                  <td>
                    {role === "analyst" ? (
                      <Link to={`/workspace/contact/${c.id}`}>{c.label}</Link>
                    ) : (
                      c.label
                    )}
                  </td>
                  <td>{c.observationIds.length}</td>
                  <td>{score(contactMetric(c).value)}</td>
                  <td>{c.priority?.toLowerCase() ?? "—"}</td>
                  <td>
                    <Status value={c.review} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <details className="dossier-provenance">
        <summary>Provenance & scientific limitations</summary>
        {record.loading && <p role="status">Loading the runtime record…</p>}
        {record.error && (
          <p role="alert">
            {record.error}{" "}
            <button className="text-link" onClick={record.reload}>
              Retry
            </button>
          </p>
        )}
        {record.data && (
          <>
            <dl>
              <div>
                <dt>Survey</dt>
                <dd className="mono">{record.data.survey_id}</dd>
              </div>
              <div>
                <dt>Detector SHA-256</dt>
                <dd className="mono">
                  {String(
                    record.data.provenance.models.detector_model_sha256 ??
                      "Not supplied",
                  )}
                </dd>
              </div>
              <div>
                <dt>Navigation</dt>
                <dd>{record.data.provenance.navigation.note}</dd>
              </div>
            </dl>
            <ul>
              {record.data.provenance.limitations.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </>
        )}
        {survey.missionNotes && <p>{survey.missionNotes}</p>}
        {!real && (
          <p>
            Illustrative associations and values. No model output, field
            evidence, or export provenance is claimed.
          </p>
        )}
      </details>
      <section className="dossier-exports">
        <div>
          <p className="eyebrow">TAKE THE RECORD FORWARD</p>
          <h2>Exports</h2>
          <p>
            {real
              ? "Original records with model and review lineage."
              : "Exports require a processed runtime survey."}
          </p>
        </div>
        {real && configured && (
          <div>
            {[
              ["json", "contacts", "Download JSON"],
              ["csv", "contacts", "Contacts CSV"],
              ["csv", "observations", "Observations CSV"],
            ].map(([format, scope, label]) => (
              <a
                key={label}
                className="button button-secondary"
                download
                href={reportUrl(
                  survey.id,
                  format as "json" | "csv",
                  scope as "contacts" | "observations",
                )}
              >
                <Download size={16} />
                {label}
              </a>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
