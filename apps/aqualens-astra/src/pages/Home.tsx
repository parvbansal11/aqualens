import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Upload,
  Map,
  AudioLines,
  ArrowRight,
  Navigation,
  FileImage,
} from "lucide-react";
import { useWorkspace } from "../lib/store";
import {
  roles,
  capabilities,
  reviewedCount,
  sortedContacts,
} from "../lib/runtime/selectors";
import { Empty, IllustrativeNote } from "../components/ui";
export default function Home() {
  const { role, survey, openSurvey, recent, loadError } = useWorkspace();
  const caps = capabilities(survey);
  const next = survey
    ? sortedContacts(survey).find(
        (c) => c.review === "PENDING" || c.review === "UNCERTAIN",
      )
    : null;
  const count = survey ? reviewedCount(survey) : 0;
  const primary =
    role === "field" && caps.navigation
      ? { to: "/workspace/map", label: "Open Map" }
      : role === "supervisor"
        ? { to: "/workspace/review", label: "Review Queue" }
        : role === "decision"
          ? { to: "/workspace/report", label: "Survey Report" }
          : { to: "/workspace/results", label: "View Contacts" };
  return (
    <main id="main-content" className="workspace-main home-page">
      <div className="home-intro">
        <div>
          <p className="eyebrow">
            {roles.find((r) => r.id === role)?.name.toUpperCase()} / WORKSPACE
          </p>
          <h1>{roles.find((r) => r.id === role)?.focus}</h1>
        </div>
        <Link className="button" to="/workspace/upload">
          <Upload size={17} />
          Upload Survey
        </Link>
      </div>
      {loadError && (
        <p role="alert" className="error-message">
          {loadError}
        </p>
      )}
      {survey ? (
        <>
          <section className="current-survey">
            <div className="current-survey-copy">
              <div className="survey-meta">
                <span className="eyebrow">CURRENT SURVEY</span>
                {survey.source === "PRESENTATION" && <IllustrativeNote />}
              </div>
              <h2>
                {survey.name.split(" · ")[0]}
                <span>{survey.name.split(" · ")[1] ?? "Side-scan survey"}</span>
              </h2>
              <p>{survey.description}</p>
              <div className="survey-counts">
                {[
                  [survey.contacts.length, "Contacts"],
                  [survey.observations.length, "Observations"],
                  [survey.frames.length, "Frames"],
                  [`${count}/${survey.contacts.length}`, "Reviewed"],
                ].map(([value, label]) => (
                  <div key={label}>
                    <strong>{value}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <div className="survey-actions">
                <Link className="button" to={primary.to}>
                  {primary.label}
                  <ArrowUpRight size={17} />
                </Link>
                {primary.to !== "/workspace/results" && (
                  <Link
                    className="button button-secondary"
                    to="/workspace/results"
                  >
                    View Contacts
                    <ArrowUpRight size={17} />
                  </Link>
                )}
                {caps.navigation && role !== "decision" && role !== "field" && (
                  <Link className="button button-secondary" to="/workspace/map">
                    <Map size={16} />
                    Open Map
                  </Link>
                )}
              </div>
              {!["decision", "supervisor"].includes(role ?? "") && (
                <Link
                  className="text-link review-home-action"
                  to="/workspace/review"
                >
                  Review Queue
                  <ArrowUpRight size={16} />
                </Link>
              )}
            </div>
            <div className="home-sonar">
              <img
                src={survey.frames[0]?.image}
                alt="Current survey source sonar raster"
              />
              <div className="sonar-label">
                <span>
                  <AudioLines size={16} />
                  THE SOURCE OF THE STORY
                </span>
                <span>{survey.frames[0]?.id}</span>
              </div>
            </div>
          </section>
          <section className="next-action">
            <div className="next-action-icon">
              <ArrowRight size={24} />
            </div>
            <div>
              <p className="eyebrow">YOUR NEXT STEP</p>
              <h3>
                {next
                  ? role === "field"
                    ? "Locate the next Contact for inspection."
                    : role === "supervisor"
                      ? "Assess the Contacts awaiting a decision."
                      : role === "decision"
                        ? "Explore the findings that need attention."
                        : "Look closer at the first Contact."
                  : "Explore the completed Contact records."}
              </h3>
              <p>
                {next
                  ? `${next.shortId} · ${next.label}`
                  : "All current Contacts have a recorded decision."}
              </p>
            </div>
            <Link
              to={
                role === "analyst" && next
                  ? `/workspace/contact/${next.id}`
                  : "/workspace/results"
              }
              className="text-link"
            >
              {role === "analyst" ? "Inspect evidence" : "View Contacts"}
              <ArrowUpRight size={17} />
            </Link>
          </section>
        </>
      ) : (
        <section className="home-empty">
          <Empty title="Upload your first sonar survey.">
            <p>A clearer operational picture starts with the source.</p>
            <Link className="button" to="/workspace/upload">
              <Upload size={17} />
              Upload Sonar Survey
            </Link>
          </Empty>
        </section>
      )}
      <section className="recent-section">
        <div className="row-heading">
          <h3>
            {recent.length ? "Recent surveys" : "Explore illustrative surveys"}
          </h3>
          <span>
            {recent.length
              ? "Retained by the analysis service"
              : "REAL SONAR · ILLUSTRATIVE EVIDENCE"}
          </span>
        </div>
        <div className="recent-list">
          {recent.map((s) => (
            <button
              key={s.id}
              className="recent-survey"
              onClick={() => void openSurvey(s.id)}
            >
              <FileImage size={24} />
              <span>
                <strong>{s.name}</strong>
                <small>
                  {s.contacts} Contacts · {s.frames} frames
                </small>
              </span>
              <ArrowUpRight size={20} />
            </button>
          ))}
          {[
            [
              "epitomeNavigated",
              "Harbour approach",
              "Navigation, depth, and connected evidence",
              Navigation,
            ],
            [
              "epitomeNoNavigation",
              "Sonar only",
              "A focused workflow without navigation",
              AudioLines,
            ],
          ].map(([id, title, text, Icon]) => {
            const I = Icon as typeof Navigation;
            return (
              <button
                key={String(id)}
                className="recent-survey"
                onClick={() => void openSurvey(String(id))}
              >
                <I size={24} />
                <span>
                  <strong>{String(title)}</strong>
                  <small>{String(text)}</small>
                </span>
                <span className="recent-illustrative">ILLUSTRATIVE</span>
                <ArrowUpRight size={20} />
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
