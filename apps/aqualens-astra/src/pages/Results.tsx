import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Search,
  Map,
  ArrowRight,
  Fingerprint,
  SlidersHorizontal,
} from "lucide-react";
import { useWorkspace } from "../lib/store";
import {
  sortedContacts,
  representative,
  score,
  capabilities,
  coordinate,
  contactMetric,
} from "../lib/runtime/selectors";
import {
  SectionHeading,
  Empty,
  IllustrativeNote,
  Status,
  Drawer,
} from "../components/ui";
import type { Contact } from "../lib/runtime/types";
export default function Results() {
  const { survey, role } = useWorkspace();
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [detail, setDetail] = useState<Contact | null>(null);
  if (!survey)
    return (
      <main id="main-content" className="workspace-main">
        <Empty title="A survey brings the picture into focus.">
          <Link className="button" to="/workspace/upload">
            Upload Survey
            <ArrowUpRight size={17} />
          </Link>
          <Link className="text-link" to="/workspace">
            Explore illustrative surveys
            <ArrowRight size={16} />
          </Link>
        </Empty>
      </main>
    );
  const contacts = sortedContacts(survey).filter(
    (c) =>
      (filter === "all" ||
        c.review === "PENDING" ||
        c.review === "UNCERTAIN") &&
      `${c.label} ${c.shortId}`.toLowerCase().includes(query.toLowerCase()),
  );
  const detailMetric = detail ? contactMetric(detail) : null;
  return (
    <main id="main-content" className="workspace-main results-page">
      <SectionHeading
        eyebrow="ANALYSE / CONTACTS"
        title="A clearer picture of the seabed."
      >
        {capabilities(survey).navigation && role !== "decision" && (
          <Link className="button button-secondary" to="/workspace/map">
            <Map size={16} />
            Open Map
          </Link>
        )}
      </SectionHeading>
      <div className="results-topline">
        <div className="results-counts">
          <strong>
            {survey.contacts.length} <span>Contacts</span>
          </strong>
          <span>{survey.observations.length} Observations</span>
          <span>{survey.frames.length} Frames</span>
        </div>
        {survey.source === "PRESENTATION" && <IllustrativeNote />}
      </div>
      <div className="results-tools">
        <div className="segmented">
          <button
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All Contacts<span>{survey.contacts.length}</span>
          </button>
          <button
            aria-pressed={filter === "review"}
            onClick={() => setFilter("review")}
          >
            Needs review
            <span>
              {
                survey.contacts.filter((c) =>
                  ["PENDING", "UNCERTAIN"].includes(c.review),
                ).length
              }
            </span>
          </button>
        </div>
        <div className="results-tool-right">
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="Search Contacts"
              placeholder="Find a Contact"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <span className="sort-label">
            <SlidersHorizontal size={14} />
            Review first
          </span>
        </div>
      </div>
      <div className="contact-list">
        {contacts.map((c) => {
          const o = representative(c, survey.observations),
            f = survey.frames.find((f) => f.id === o?.frameId),
            metric = contactMetric(c);
          const body = (
            <>
              <div className="result-thumbnail">
                {f && (
                  <img
                    src={f.image}
                    alt={`${c.shortId} source sonar`}
                    loading="lazy"
                  />
                )}
                <span className="mono">{c.shortId}</span>
              </div>
              <div className="result-main">
                <div className="result-title">
                  <h2>{c.label}</h2>
                  {c.openSet?.candidate && (
                    <span className="unusual-tag">
                      <Fingerprint size={14} />
                      Unusual pattern
                    </span>
                  )}
                </div>
                <div className="result-meta">
                  <span>{c.observationIds.length} observations</span>
                  {c.persistence && (
                    <span>Across {c.persistence.frames} frames</span>
                  )}
                  {c.position && (
                    <span className="coordinate-text">
                      {coordinate(c.position.lat, true)} ·{" "}
                      {coordinate(c.position.lon, false)}
                    </span>
                  )}
                </div>
              </div>
              <div className="result-evidence">
                {metric.value !== null && (
                  <>
                    <span>{metric.label}</span>
                    <strong>{score(metric.value)}</strong>
                  </>
                )}
              </div>
              <div className="result-end">
                <Status value={c.review} />
                <span className="inspect-link">
                  Inspect
                  <ArrowUpRight size={18} />
                </span>
              </div>
            </>
          );
          return role === "analyst" ? (
            <Link
              key={c.id}
              className="result-row"
              to={`/workspace/contact/${encodeURIComponent(c.id)}`}
            >
              {body}
            </Link>
          ) : (
            <button
              key={c.id}
              className="result-row"
              onClick={() => setDetail(c)}
            >
              {body}
            </button>
          );
        })}
      </div>
      {!contacts.length && (
        <Empty title="No Contacts match this view.">
          <button
            className="text-link"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Clear filters
            <ArrowRight size={16} />
          </button>
        </Empty>
      )}
      <div className="results-foot">
        <span>One Contact brings its source observations together.</span>
        <details>
          <summary>About evidence strength</summary>
          <p>
            Evidence strength combines available channels. It is not a
            calibrated probability. Open-set scores measure distance from
            reference memory.
          </p>
          {survey.source === "PRESENTATION" && (
            <p>
              All values, labels, and associations in this survey are
              illustrative. No model was run on these images for this preview.
            </p>
          )}
        </details>
      </div>
      {detail && (
        <Drawer title={detail.label} onClose={() => setDetail(null)}>
          <div className="summary-drawer">
            <span className="mono">{detail.shortId}</span>
            <Status value={detail.review} />
            <p>{detail.observationIds.length} source observations</p>
            {detailMetric && detailMetric.value !== null && (
              <p>
                {detailMetric.label} {score(detailMetric.value)}
              </p>
            )}
            {detail.position && role !== "decision" && (
              <Link
                className="button"
                to={`/workspace/map?contact=${detail.id}`}
                onClick={() => setDetail(null)}
              >
                Locate Contact
                <ArrowUpRight size={16} />
              </Link>
            )}
            <p className="muted">
              Full sonar inspection is available at the Sonar Analyst station.
            </p>
          </div>
        </Drawer>
      )}
    </main>
  );
}
