import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "../api/client";
import { displayName, shortTime } from "../api/labels";
import type { Job, JobStep, Mission, Upload } from "../api/types";
import { HomeMark } from "../components/HomeMark";
import { DemoTag, Icon } from "../components/ui";
import { hrefFor, navigate } from "../router";
import { useStore } from "../state/store";

/**
 * Survey Intake, the real-mode entry. Selecting a file only selects it. Nothing is called ingested
 * until the local service has accepted and decoded it, and nothing is called ready until its
 * processing job reports COMPLETED. Every state shown after selection comes from the backend.
 */

/** Exactly what POST /missions/{id}/uploads accepts (RASTER_SUFFIXES plus .zip). */
const KINDS: Record<string, string> = { ".png": "PNG raster", ".jpg": "JPEG raster", ".jpeg": "JPEG raster", ".pbm": "PBM raster", ".zip": "ZIP survey bundle" };
const ACCEPT = Object.keys(KINDS).join(",");
const extOf = (name: string) => (/\.[^.]+$/.exec(name.toLowerCase())?.[0] ?? "");
const stem = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Survey";

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

interface Picked {
  name: string;
  size: number;
  kind: string;
}
type Phase = "empty" | "selected" | "uploading" | "processing" | "ready" | "failed";
interface Problem {
  title: string;
  message: string;
  /** The same file can be sent again (network, duplicate check aside). */
  retry: boolean;
}

/** A run the backend is still working on, so a refresh can pick it up again from the service. */
const PENDING = "aqualens.intake.pending";
interface Pending extends Picked {
  missionId: string;
  jobId: string;
}
const readPending = (): Pending | null => {
  try {
    return JSON.parse(localStorage.getItem(PENDING) ?? "null");
  } catch {
    return null;
  }
};
const writePending = (p: Pending | null) => {
  try {
    if (p) localStorage.setItem(PENDING, JSON.stringify(p));
    else localStorage.removeItem(PENDING);
  } catch {
    /* recovery is a convenience; the Mission is on the backend either way */
  }
};

const stepsOf = (job: Job | null): JobStep[] => (Array.isArray(job?.steps) ? job.steps : []);

function explain(e: unknown): Problem {
  if (!(e instanceof ApiFailure)) return { title: "Upload failed", message: "The upload was not accepted.", retry: true };
  if (e.offline) return { title: "Backend unavailable", message: e.message, retry: true };
  const title =
    {
      VALIDATION_FAILED: "Not accepted",
      UNREADABLE_BUNDLE: "Invalid bundle",
      UNSAFE_ARCHIVE: "Invalid bundle",
      DUPLICATE_ARCHIVE_NAME: "Invalid bundle",
      EMPTY_BUNDLE: "Invalid bundle",
      UNREADABLE_RASTER: "Unreadable raster",
      UPLOAD_TOO_LARGE: "File too large",
      DUPLICATE_UPLOAD: "Already uploaded",
    }[e.code] ?? "Upload failed";
  return { title, message: e.message, retry: !["DUPLICATE_UPLOAD", "UNREADABLE_BUNDLE", "UNSAFE_ARCHIVE", "DUPLICATE_ARCHIVE_NAME", "EMPTY_BUNDLE", "UNREADABLE_RASTER", "VALIDATION_FAILED", "UPLOAD_TOO_LARGE"].includes(e.code) };
}

export function Start() {
  const { state, openMission } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const [file, setFile] = useState<File | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [phase, setPhase] = useState<Phase>("empty");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [dragging, setDragging] = useState(false);
  /** The Mission created for this intake. Retrying the same file reuses it, so a rejected attempt
   *  leaves no second Mission; a different file never inherits it. */
  const mission = useRef<{ id: string; file: string; used: boolean } | null>(null);
  const resumed = useRef(false);
  const [readyMission, setReadyMission] = useState<string | null>(null);
  /** The service answered 202: it holds the bytes. Set only from that response (or a resumed run). */
  const [received, setReceived] = useState(false);

  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  /** Follow a job on the backend until it finishes. Used after an upload and after a refresh. */
  const follow = useCallback(
    async (missionId: string, jobId: string) => {
      setPhase("processing");
      try {
        let current = await api.job(jobId);
        while (alive.current && current.state !== "COMPLETED" && current.state !== "FAILED") {
          setJob(current);
          await new Promise((r) => setTimeout(r, 700));
          current = await api.job(jobId);
        }
        if (!alive.current) return;
        setJob(current);
        writePending(null);
        if (current.state === "FAILED") {
          setProblem({ title: "Processing failed", message: current.error?.message ?? "The local service could not process this survey.", retry: false });
          setPhase("failed");
          return;
        }
        openMission("live", missionId);
        setReadyMission(missionId);
        setPhase("ready");
      } catch (e) {
        if (!alive.current) return;
        setProblem(explain(e));
        setPhase("failed");
      }
    },
    [openMission],
  );

  // A refresh during processing resumes from the backend's own job record.
  useEffect(() => {
    // Only the one job this intake started; historical jobs are never polled.
    const pending = readPending();
    if (!pending || resumed.current) return;
    resumed.current = true;
    setReceived(true);
    mission.current = { id: pending.missionId, file: `${pending.name}:${pending.size}`, used: true };
    setPicked({ name: pending.name, size: pending.size, kind: pending.kind });
    void follow(pending.missionId, pending.jobId);
  }, [follow]);

  const choose = (f: File | undefined) => {
    if (!f) return;
    const kind = KINDS[extOf(f.name)];
    setFile(f);
    setPicked({ name: f.name, size: f.size, kind: kind ?? "Unsupported file" });
    setJob(null);
    setReceived(false);
    if (!kind) {
      setProblem({ title: "Unsupported format", message: "Aqualens accepts PNG, JPEG or PBM rasters, or a ZIP survey bundle.", retry: false });
      setPhase("failed");
      return;
    }
    if (f.size === 0) {
      setProblem({ title: "Empty file", message: "This file has no content to process.", retry: false });
      setPhase("failed");
      return;
    }
    setProblem(null);
    setPhase("selected");
  };

  const clear = () => {
    setFile(null);
    setPicked(null);
    setProblem(null);
    setJob(null);
    setPhase("empty");
  };

  const process = async () => {
    if (!file || !picked) return;
    setReceived(false);
    setProblem(null);
    setJob(null);
    setPhase("uploading");
    try {
      const same = `${file.name}:${file.size}:${file.lastModified}`;
      if (!mission.current || mission.current.used || mission.current.file !== same) mission.current = { id: (await api.createMission(stem(file.name))).mission_id, file: same, used: false };
      const accepted = await api.upload(mission.current.id, file);
      mission.current.used = true;
      setReceived(true);
      writePending({ ...picked, missionId: mission.current.id, jobId: accepted.job_id });
      if (alive.current) await follow(mission.current.id, accepted.job_id);
    } catch (e) {
      if (!alive.current) return;
      setProblem(explain(e));
      setPhase("failed");
    }
  };

  const busy = phase === "uploading" || phase === "processing";
  const offline = !state.online || state.phase === "offline";
  const decoded = stepsOf(job).find((s) => s.id === "upload_decoded");
  const ingested = decoded?.state === "done";
  // Each milestone is lit only by its own backend event, in order.
  // "Received" is the 202 from the service; until then the same slot reads "Uploading".
  const milestones: [string, boolean][] = [
    ["Received", received],
    ["Ingested", received && ingested],
    ["Processed", phase === "ready"],
  ];
  const activeAt = milestones.findIndex(([, done]) => !done);

  return (
    <div className="intake">
      <header className="intake__bar">
        <HomeMark className="intake__mark" />
        <span className="intake__crumb">Survey Intake</span>
      </header>

      <main className="intake__main">
        <h1 className="intake__title">Start with survey data.</h1>
        <p className="intake__lede">Choose a side-scan sonar raster or a survey bundle. It is processed by the local Aqualens service.</p>

        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          hidden
          aria-label="Survey file"
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        <section
          className={`drop is-${phase} ${dragging ? "is-over" : ""}`}
          aria-label="Survey file"
          onDragOver={(e) => {
            if (busy) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) choose(e.dataTransfer.files?.[0]);
          }}
        >
          {!picked ? (
            <button className="drop__empty" onClick={() => input.current?.click()} disabled={offline}>
              <svg className="drop__icon" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
                <path d="M20 26V9M13 15.5 20 8.5l7 7M8 24v7.5h24V24" />
              </svg>
              <span className="drop__title">{dragging ? "Release to select" : "Drop your survey here"}</span>
              <span className="drop__hint">
                or <u>browse files</u> on this computer
              </span>
              <span className="drop__formats">PNG · JPEG · PBM · ZIP bundle</span>
            </button>
          ) : (
            <div className="drop__file">
              <span className={`drop__glyph is-${phase}`} aria-hidden="true">
                {phase === "failed" ? <Icon name="close" size={16} /> : phase === "selected" || phase === "ready" ? <Icon name="check" size={16} /> : <i />}
              </span>
              <div className="drop__meta">
                <p className="drop__name">{picked.name}</p>
                <p className="drop__facts">
                  <span>{formatBytes(picked.size)}</span>
                  <span>{picked.kind}</span>
                </p>
                <p className="drop__state" role="status" aria-live="polite">
                  {phase === "selected" && "Selected · ready to process"}
                  {phase === "uploading" && "Uploading to the local service"}
                  {phase === "processing" && (ingested ? "Survey ingested · processing" : "Received · waiting for the processing job")}
                  {phase === "ready" && "Processed · survey ready"}
                  {phase === "failed" && problem?.title}
                </p>
              </div>
              {(phase === "selected" || phase === "failed") && (
                <div className="drop__tools">
                  <button className="link" onClick={() => input.current?.click()}>
                    Change file
                  </button>
                  <button className="icon-btn" onClick={clear} aria-label="Remove selected file">
                    <Icon name="close" size={14} />
                  </button>
                </div>
              )}
              {(busy || phase === "ready" || (phase === "failed" && received)) && (
                <ol className="rail" aria-label="Intake progress">
                  {milestones.map(([label, done], i) => (
                    <li key={label} className={done ? "is-done" : i === activeAt ? (phase === "failed" ? "is-failed" : busy ? "is-active" : "") : ""} aria-current={i === activeAt && busy ? "step" : undefined}>
                      <i aria-hidden="true" />
                      {!done && busy && i === activeAt ? (i === 0 ? "Uploading" : i === 2 ? "Processing" : label) : label}
                    </li>
                  ))}
                </ol>
              )}
              {busy && <span className="drop__progress" aria-hidden="true" />}
            </div>
          )}
        </section>

        {offline && <p className="intake__problem" role="alert">The local Aqualens service is not reachable. Start it, then try again.</p>}

        {phase === "selected" && (
          <div className="intake__actions">
            <button className="btn btn--primary btn--xl" onClick={() => void process()} disabled={offline}>
              Process survey <Icon name="arrowRight" size={15} />
            </button>
          </div>
        )}

        {phase === "failed" && problem && (
          <div className="intake__failure" role="alert">
            <p>{problem.message}</p>
            <div className="intake__actions">
              {problem.retry && file && (
                <button className="btn btn--primary btn--xl" onClick={() => void process()}>
                  <Icon name="refresh" size={14} /> Retry
                </button>
              )}
              <button className={`btn btn--xl ${problem.retry && file ? "" : "btn--primary"}`} onClick={() => input.current?.click()}>
                Change file
              </button>
            </div>
          </div>
        )}

        {/* Once ready, the summary below carries the skipped and unavailable steps; the full list is only needed while it runs or after a failure. */}
        {(busy || (phase === "failed" && job)) && <Steps uploading={phase === "uploading"} job={job} />}

        {phase === "ready" && readyMission && <Ready missionId={readyMission} job={job} onContinue={() => navigate(hrefFor("roles"))} />}

        {!busy && phase !== "ready" && <Previous />}

        {!busy && phase !== "ready" && (
          <footer className="intake__foot">
            <a className="link" href="/workspace?demo=1">
              Explore demo mission
            </a>
            <DemoTag />
            <span>A deterministic fixture, kept apart from your surveys.</span>
          </footer>
        )}
      </main>
    </div>
  );
}

const GLYPH: Record<JobStep["state"], string> = { queued: "", running: "", done: "✓", skipped: "–", unavailable: "–", failed: "×" };

/** The upload request, then the job's own steps in the backend's order and words. */
function Steps({ uploading, job }: { uploading: boolean; job: Job | null }) {
  return (
    <ol className="steps" aria-label="Processing steps">
      <li className={`steps__row is-${uploading ? "running" : "done"}`}>
        <i aria-hidden="true">{uploading ? "" : "✓"}</i>
        <span>Upload sent</span>
      </li>
      {stepsOf(job).map((s) => (
        <li key={s.id} className={`steps__row is-${s.state}`}>
          <i aria-hidden="true">{GLYPH[s.state]}</i>
          <span>
            {s.label}
            {s.detail && s.state !== "queued" && s.state !== "done" && <small>{s.detail}</small>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Ready({ missionId, job, onContinue }: { missionId: string; job: Job | null; onContinue: () => void }) {
  const { state } = useStore();
  const loaded = state.phase === "ready" && state.missionId === missionId;
  const frames = state.surveys.reduce((n, s) => n + s.frames.length, 0);
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (loaded) go.current?.focus({ preventScroll: true });
  }, [loaded]);
  if (!loaded)
    return (
      <p className="intake__lede" aria-busy="true">
        Opening the mission from the local service.
      </p>
    );
  const notes = stepsOf(job).filter((s) => (s.state === "skipped" || s.state === "unavailable") && s.detail);
  return (
    <section className="ready" aria-labelledby="ready-title">
      <h2 id="ready-title" className="ready__title">
        Survey ready.
      </h2>
      <dl className="ready__facts">
        <div>
          <dt>Mission</dt>
          <dd className="ready__name">{displayName(state.mission?.name, "Mission")}</dd>
        </div>
        <div>
          <dt>Surveys</dt>
          <dd>{state.surveys.length}</dd>
        </div>
        <div>
          <dt>Frames</dt>
          <dd>{frames}</dd>
        </div>
        <div>
          <dt>Contacts</dt>
          <dd>{state.contacts.length}</dd>
        </div>
      </dl>
      {state.contacts.length === 0 && <p className="ready__empty">No supervised Contacts detected.</p>}
      {notes.length > 0 && (
        <ul className="ready__notes">
          {notes.map((s) => (
            <li key={s.id}>
              <b>{s.label}.</b> {s.detail}
            </li>
          ))}
        </ul>
      )}
      <div className="intake__actions">
        <button ref={go} className="btn btn--primary btn--xl" onClick={onContinue}>
          Continue to role selection <Icon name="arrowRight" size={15} />
        </button>
      </div>
    </section>
  );
}

const UPLOAD_STATE: Record<string, string> = { READY: "Ready", FAILED: "Failed", INGESTING: "Processing", PENDING: "Processing" };

/**
 * Previous surveys, read from the backend. Each intake creates one Mission, so a row is a real
 * Mission with its uploaded files. Missions that never received an upload are not listed.
 */
function Previous() {
  const { state, openMission } = useStore();
  const [uploads, setUploads] = useState<Record<string, Upload[]>>({});
  const [all, setAll] = useState(false);
  const missions: Mission[] = state.missions.filter((m) => (m.upload_ids?.length ?? 0) > 0).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const shown = all ? missions : missions.slice(0, 6);
  const key = shown.map((m) => m.mission_id).join(",");
  useEffect(() => {
    let live = true;
    const missing = shown.filter((m) => !uploads[m.mission_id]);
    if (!missing.length) return;
    void Promise.all(missing.map((m) => api.uploads(m.mission_id).then((u) => [m.mission_id, u] as const, () => [m.mission_id, []] as const))).then((rows) => {
      if (live) setUploads((prev) => ({ ...prev, ...Object.fromEntries(rows) }));
    });
    return () => void (live = false);
    // Fetched once per visible Mission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (state.phase === "loading" && !state.missions.length) return null;
  return (
    <section className="previous" aria-labelledby="previous-title">
      <div className="previous__head">
        <h2 id="previous-title">Previous surveys</h2>
        <span>{missions.length ? `${missions.length} mission${missions.length === 1 ? "" : "s"} on the local service` : ""}</span>
      </div>
      {missions.length === 0 ? (
        <p className="previous__none">No surveys yet. Your first upload will appear here.</p>
      ) : (
        <ul className="previous__list">
          {shown.map((m) => {
            const ups = uploads[m.mission_id];
            const files = ups?.map((u) => u.filename).filter(Boolean) ?? [];
            const status = ups?.length ? (ups.some((u) => u.status === "FAILED") ? "FAILED" : ups.every((u) => u.status === "READY") ? "READY" : "INGESTING") : null;
            const current = state.source === "live" && state.missionId === m.mission_id;
            const surveys = m.survey_ids?.length ?? 0;
            return (
              <li key={m.mission_id}>
                <button
                  className="previous__row"
                  onClick={() => {
                    if (!current) openMission("live", m.mission_id);
                    navigate(current && state.role ? hrefFor(state.role.home) : hrefFor("roles"));
                  }}
                >
                  <span className="previous__main">
                    <span className="previous__name">
                      {displayName(m.name, "Mission")}
                      {current && <span className="previous__open">Open</span>}
                    </span>
                    <span className="previous__sub">
                      {files.length ? files.join(", ") : ups ? "" : "Loading files"}
                    </span>
                  </span>
                  <span className="previous__cell">
                    {surveys} survey{surveys === 1 ? "" : "s"}
                  </span>
                  <span className={`previous__cell previous__status is-${status?.toLowerCase() ?? "unknown"}`}>{status ? UPLOAD_STATE[status] : ""}</span>
                  <time className="previous__cell">{shortTime(m.created_at)}</time>
                  <Icon name="chevronRight" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {missions.length > shown.length && (
        <button className="link previous__more" onClick={() => setAll(true)}>
          Show all {missions.length}
        </button>
      )}
    </section>
  );
}
