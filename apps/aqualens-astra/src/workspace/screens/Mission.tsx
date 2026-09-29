import { useRef, useState } from "react";
import { hrefFor, navigate } from "../router";
import { isReviewed, useStore } from "../state/store";
import { displayName, MEMBERSHIP, navLabel, shortTime } from "../api/labels";
import { api, ApiFailure } from "../api/client";
import type { Job } from "../api/types";
import { DemoTag, Empty, Icon, StateGlyph } from "../components/ui";

export function MissionScreen() {
  const { state } = useStore();
  const mission = state.mission;
  if (!mission) return <Empty title="No mission open">Open a mission from the Overview.</Empty>;
  const reviewed = state.contacts.filter(isReviewed).length;

  return (
    <div className="page">
      <header className="page__head">
        <p className="page__eyebrow">Mission</p>
        <h1 className="page__title">{displayName(mission.name, "Mission")}</h1>
        <p className="page__meta">
          {mission.demo && <DemoTag>Demo mission</DemoTag>}
          <span>Created {shortTime(mission.created_at)}</span>
          <span>Operator {mission.operator ?? <span className="muted">not supplied</span>}</span>
          <span>
            {reviewed} of {state.contacts.length} Contacts reviewed
          </span>
        </p>
        {mission.notes && <p className="page__lede">{mission.notes}</p>}
      </header>

      {!mission.demo && <UploadPanel missionId={mission.mission_id} />}

      <section className="block" aria-labelledby="m-surveys">
        <div className="block__head">
          <h2 id="m-surveys">Surveys</h2>
          <p>A Survey is one contiguous recording by one sonar in one pass. An upload may hold several.</p>
        </div>
        {state.surveys.length === 0 ? (
          <p className="muted">No Survey yet.{mission.demo ? "" : " Upload a raster or a prepared bundle above."}</p>
        ) : (
          <ol className="surveys">
            {state.surveys.map((s) => {
              const cs = state.contacts.filter((c) => c.survey_refs.includes(s.survey_ref));
              const open = cs.filter((c) => !isReviewed(c));
              const m = MEMBERSHIP[s.membership_provenance] ?? { label: s.membership_provenance, text: "" };
              return (
                <li key={s.survey_id} className="survey">
                  <div className="survey__id">
                    <p className="survey__name">{displayName(s.name, s.survey_ref)}</p>
                    <p className="survey__sub">{s.status === "READY" ? "Ready" : s.status === "FAILED" ? "Processing failed" : "Processing"}</p>
                  </div>
                  <dl className="survey__facts">
                    <div>
                      <dt>Membership</dt>
                      <dd title={m.text}>{m.label}</dd>
                    </div>
                    <div>
                      <dt>Navigation</dt>
                      <dd>
                        <StateGlyph state={s.navigation_provenance === "SYNTHETIC_DEMO" ? "NOT_VALIDATED" : s.navigation_provenance ? "AVAILABLE" : "UNAVAILABLE"} /> {navLabel(s.navigation_provenance)}
                      </dd>
                    </div>
                    <div>
                      <dt>Sensor</dt>
                      <dd>{s.sensor ?? <span className="muted">Not supplied</span>}</dd>
                    </div>
                    <div>
                      <dt>Acquired</dt>
                      <dd>{s.acquired_at ? shortTime(s.acquired_at) : <span className="muted">Not supplied</span>}</dd>
                    </div>
                    <div>
                      <dt>Frames</dt>
                      <dd className="num">{s.frames.length || <span className="muted">None stored</span>}</dd>
                    </div>
                    <div>
                      <dt>Contacts</dt>
                      <dd className="num">{cs.length ? `${cs.length} · ${open.length} awaiting` : <span className="muted">None proposed</span>}</dd>
                    </div>
                  </dl>
                  <div className="survey__go">
                    {cs.length ? (
                      <button className="btn" onClick={() => navigate(hrefFor("review", (open[0] ?? cs[0]).contact_id))}>
                        Review {displayName(s.name, "Survey")}
                      </button>
                    ) : (
                      <span className="muted small">Nothing to review</span>
                    )}
                  </div>
                  {m.text && <p className="survey__note">{m.text}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <div className="split">
        <section className="block" aria-labelledby="m-uploads">
          <div className="block__head">
            <h2 id="m-uploads">Uploads</h2>
          </div>
          {state.uploads.length === 0 ? (
            <p className="muted">No uploads yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Status</th>
                  <th>Navigation</th>
                  <th>SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {state.uploads.map((u) => (
                  <tr key={u.upload_id}>
                    <td className="mono">{u.filename ?? (u.source === "BUILTIN_SYNTHETIC_FIXTURE" ? "Built-in demo fixture" : u.upload_id)}</td>
                    <td>{u.status === "READY" ? "Ready" : u.status === "FAILED" ? "Failed" : "Processing"}</td>
                    <td>{u.navigation_provenance ? navLabel(u.navigation_provenance) : <span className="muted">{u.demo ? "Synthetic demo" : "Not supplied"}</span>}</td>
                    <td className="mono">{u.sha256 ? `${u.sha256.slice(0, 10)}…` : <span className="muted">None</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="block" aria-labelledby="m-jobs">
          <div className="block__head">
            <h2 id="m-jobs">Processing</h2>
            <p>Observed job states from the local service. Nothing is estimated.</p>
          </div>
          {state.jobs.length === 0 ? (
            <p className="muted">No processing runs yet.</p>
          ) : (
            <ol className="timeline">
              {state.jobs.map((j) => (
                <JobRow key={j.job_id} job={j} />
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  const state = job.state === "COMPLETED" ? "Completed" : job.state === "FAILED" ? "Failed" : job.state.charAt(0) + job.state.slice(1).toLowerCase();
  return (
    <li className={job.state === "FAILED" ? "timeline__failed" : undefined}>
      <time>{shortTime(job.completed_at ?? job.started_at)}</time>
      <span>
        {state}
        {job.error ? ` · ${job.error.message}` : ""}
        {job.warnings?.length ? ` · ${job.warnings.map((w) => w.replace(/^DEMO:\s*/, "Demo: ")).join(" · ")}` : ""}
      </span>
    </li>
  );
}

/** Real upload into a real Mission. Accepted, then processed by the frozen detector on the service. */
function UploadPanel({ missionId }: { missionId: string }) {
  const { reload, notify } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (file: File) => {
    setBusy(true);
    try {
      const accepted = await api.upload(missionId, file);
      let current = await api.job(accepted.job_id);
      setJob(current);
      while (current.state !== "COMPLETED" && current.state !== "FAILED") {
        await new Promise((r) => setTimeout(r, 900));
        current = await api.job(accepted.job_id);
        setJob(current);
      }
      notify(current.state === "COMPLETED" ? "Processing complete" : current.error?.message ?? "Processing failed", current.state === "FAILED" ? "error" : undefined);
      await reload();
    } catch (e) {
      notify(e instanceof ApiFailure ? e.message : "The upload was not accepted.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="block upload" aria-labelledby="m-upload">
      <div className="block__head">
        <h2 id="m-upload">Add sonar</h2>
        <p>PNG, JPEG or PBM rasters, or a prepared ZIP bundle. Processing starts on the local service when the file is accepted.</p>
      </div>
      <div className="row gap">
        <input
          ref={input}
          type="file"
          accept=".png,.jpg,.jpeg,.pbm,.zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void send(f);
            e.target.value = "";
          }}
        />
        <button className="btn btn--primary" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="upload" size={14} /> {busy ? "Processing" : "Upload sonar"}
        </button>
        {job && (
          <span className="muted small" aria-live="polite">
            {job.state === "COMPLETED" ? "Completed" : job.state === "FAILED" ? "Failed" : `${job.stage ?? job.state}`}
            {typeof job.frames_completed === "number" && typeof job.source_frame_count === "number" ? ` · ${job.frames_completed} of ${job.source_frame_count} frames` : ""}
          </span>
        )}
      </div>
    </section>
  );
}
