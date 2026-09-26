import { useState } from "react";
import { History, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../lib/store";
import { configured } from "../lib/runtime/api";
import { useRemote } from "../lib/runtime/useRemote";
import type { MemoryEvents, MemoryStats } from "../lib/runtime/wire";
import { SectionHeading, Empty } from "../components/ui";
export default function Memory() {
  const { survey, role } = useWorkspace();
  const [all, setAll] = useState(false),
    [verdict, setVerdict] = useState("");
  const path =
    configured && (all || survey?.source === "RUNTIME")
      ? `/runtime/memory/reviews?limit=100${all ? "" : `&survey_id=${encodeURIComponent(survey!.id)}`}`
      : null;
  const events = useRemote<MemoryEvents>(path),
    stats = useRemote<MemoryStats>(configured ? "/runtime/memory/stats" : null);
  const rows =
    events.data?.items.filter((e) => !verdict || e.verdict === verdict) ?? [];
  return (
    <main id="main-content" className="workspace-main memory-page">
      <SectionHeading
        eyebrow="HUMAN DECISIONS / DURABLE LINEAGE"
        title="Review Memory"
      />
      <div className="memory-topline">
        <p>Append-only analyst decisions.</p>
        {stats.data && (
          <div className="memory-contract">
            <span>
              Append-only{" "}
              <b>{stats.data.append_only ? "Enabled" : "Disabled"}</b>
            </span>
            <span>
              Online learning{" "}
              <b>{stats.data.online_learning ? "Enabled" : "Disabled"}</b>
            </span>
          </div>
        )}
      </div>
      <div className="results-tools">
        <div className="segmented">
          <button aria-pressed={!all} onClick={() => setAll(false)}>
            This survey
          </button>
          <button aria-pressed={all} onClick={() => setAll(true)}>
            All surveys
          </button>
        </div>
        <label className="compact-select">
          Decision
          <select
            aria-label="Filter review decisions"
            value={verdict}
            onChange={(e) => setVerdict(e.target.value)}
          >
            <option value="">All decisions</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="REJECTED">Rejected</option>
            <option value="UNCERTAIN">Needs review</option>
            <option value="RELABELLED">Relabelled</option>
          </select>
        </label>
      </div>
      {events.loading && <p role="status">Reading Review Memory…</p>}
      {events.error && (
        <p className="error-message" role="alert">
          {events.error}
          <button className="text-link" onClick={events.reload}>
            Retry
          </button>
        </p>
      )}
      {!path ? (
        <Empty title="Runtime decisions live here.">
          <p>
            {configured
              ? "Illustrative surveys do not create memory events."
              : "Connect the analysis service to read Review Memory."}
          </p>
          {configured && (
            <button
              className="button button-secondary"
              onClick={() => setAll(true)}
            >
              Read all runtime decisions
            </button>
          )}
        </Empty>
      ) : !events.loading && !events.error && !rows.length ? (
        <Empty title="No decisions recorded in this view.">
          <Link className="text-link" to="/workspace/review">
            Open Review Queue
            <ArrowUpRight size={16} />
          </Link>
        </Empty>
      ) : (
        <ol className="memory-timeline">
          {rows.map((e) => (
            <li key={e.review_id}>
              <History size={19} />
              <details>
                <summary>
                  <div>
                    <strong>
                      {e.verdict === "UNCERTAIN"
                        ? "Needs review"
                        : e.verdict
                            .toLowerCase()
                            .replace(/^./, (c) => c.toUpperCase())}
                    </strong>
                    <span>{e.reviewer}</span>
                  </div>
                  <div>
                    <span className="mono">
                      {e.contact_id ?? e.detection_id}
                    </span>
                    <time dateTime={e.created_at}>
                      {new Date(e.created_at).toLocaleString()}
                    </time>
                  </div>
                </summary>
                <div className="memory-event-details">
                  <p>{e.survey_name}</p>
                  {e.notes && <p>{e.notes}</p>}
                  <dl>
                    <div>
                      <dt>Curated queue</dt>
                      <dd>{e.training_memory_queue.replace(/_/g, " ")}</dd>
                    </div>
                    <div>
                      <dt>Observation</dt>
                      <dd className="mono">{e.detection_id}</dd>
                    </div>
                    <div>
                      <dt>Detector SHA-256</dt>
                      <dd className="mono">{e.model_sha256}</dd>
                    </div>
                    <div>
                      <dt>Export lineage</dt>
                      <dd>Preserved in the survey JSON record</dd>
                    </div>
                  </dl>
                  {e.survey_id === survey?.id &&
                    e.contact_id &&
                    role === "analyst" && (
                      <Link
                        className="text-link"
                        to={`/workspace/contact/${e.contact_id}`}
                      >
                        Inspect Contact
                        <ArrowUpRight size={15} />
                      </Link>
                    )}
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
      <p className="archive-note">
        Review events inform future curated training data. Recording a decision
        does not update the model.
      </p>
    </main>
  );
}
