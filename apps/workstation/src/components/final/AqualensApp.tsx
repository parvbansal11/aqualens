"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell, HOME, roleHolds } from "./shell/AppShell";
import { LandingScreen } from "./screens/LandingScreen";
import { RoleEntryScreen } from "./screens/RoleEntryScreen";
import { UploadScreen } from "./screens/UploadScreen";
import { ProcessingScreen } from "./screens/ProcessingScreen";
import { ResultsScreen } from "./screens/ResultsScreen";
import { MapScreen, type MapGeometry, type MapMode } from "./screens/MapScreen";
import { WorkspaceScreen } from "./screens/WorkspaceScreen";
import { ReviewScreen } from "./screens/ReviewScreen";
import { MissionScreen } from "./screens/MissionScreen";
import { DecisionScreen } from "./screens/DecisionScreen";
import { ReportScreen } from "./screens/ReportScreen";
import { ModelLabScreen } from "./screens/ModelLabScreen";
import { ChangeScreen } from "./screens/ChangeScreen";
import { MemoryScreen } from "./screens/MemoryScreen";
import { PermissionScreen } from "./screens/PermissionScreen";
import type { Layer } from "./parts/SonarFrame";
import {
  ApiError,
  JOB_STORAGE_KEY,
  SURVEY_STORAGE_KEY,
  failureSentence,
  fetchHealth,
  fetchJob,
  fetchRuntimeSurvey,
  fetchRuntimeSurveyIndex,
  postReview,
  rasterUrl,
  uploadSurvey,
} from "./runtime/api";
import { contactViews, representativeObservation, reviewQueue, sortedFindings, surveyTimestamp, surveyTrack } from "./runtime/select";
import type {
  ConnectionState,
  RoleId,
  RuntimeFinding,
  RuntimeHealth,
  RuntimeJob,
  RuntimeSurvey,
  RuntimeSurveySummary,
  Screen,
  Verdict,
} from "./runtime/types";

const REVIEWER = "local operator";

/** Health cadence: relaxed while the service answers, brisk while it does not. */
const HEALTH_INTERVAL_OK_MS = 30_000;
const HEALTH_INTERVAL_DOWN_MS = 5_000;
/** Job polling only runs while a run is actually in flight. */
const JOB_POLL_MS = 900;

function readStored(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* a browser with storage disabled still runs; it just cannot reconnect */
  }
}

/** A proportional scatter of real recorded lat/lon onto the chart's fixed
 * viewBox -- not a map projection, and never drawn when no finding carries a
 * position. A single point (zero span) centers rather than dividing by zero.
 * The survey track is drawn from the same frame of reference so markers and
 * track cannot disagree. */
export function geometryFromFindings(
  findings: RuntimeFinding[],
  track: { frameId: string; lat: number; lon: number }[] = [],
): MapGeometry | null {
  const positioned = findings.filter(
    (f): f is RuntimeFinding & { geo: { lat: number; lon: number } } =>
      f.geo.lat !== null && f.geo.lon !== null,
  );
  const points = [
    ...positioned.map((f) => ({ lat: f.geo.lat, lon: f.geo.lon })),
    ...track.map((t) => ({ lat: t.lat, lon: t.lon })),
  ];
  if (points.length === 0) return null;

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const lonSpan = Math.max(...lons) - Math.min(...lons);
  const minLat = Math.min(...lats);
  const minLon = Math.min(...lons);
  const margin = 12;
  const span = 100 - margin * 2;

  const project = (lat: number, lon: number): [number, number] => [
    margin + (lonSpan === 0 ? span / 2 : ((lon - minLon) / lonSpan) * span),
    // North is up: higher latitude renders nearer the top of the chart.
    margin + (latSpan === 0 ? span / 2 : (1 - (lat - minLat) / latSpan) * span),
  ];

  const markers: Record<string, [number, number]> = {};
  for (const finding of positioned) {
    markers[finding.detection_id] = project(finding.geo.lat, finding.geo.lon);
  }

  return {
    coastline: null,
    swath: null,
    gap: null,
    gapArea: null,
    cornerLabel: null,
    scaleLabel: null,
    markers,
    /* The track is the real per-frame navigation fixes, in frame order, joined
     * as recorded. Nothing is interpolated between them and nothing is drawn
     * when a frame carries no fix. */
    track: track.map((point) => ({ frameId: point.frameId, point: project(point.lat, point.lon) })),
  };
}

/**
 * The frozen screens over the real runtime. One shared record set feeds all
 * four roles; role is a view contract that filters fields and guards routes,
 * never a second data model.
 */
export function AqualensApp({ initial = "landing" }: { initial?: Screen }) {
  const [screen, setScreen] = useState<Screen>(initial);
  const [role, setRole] = useState<RoleId>("analyst");
  const [picked, setPicked] = useState<RoleId | null>(null);

  const [survey, setSurvey] = useState<RuntimeSurvey | null>(null);
  const [loadingSurvey, setLoadingSurvey] = useState(true);
  const [surveyError, setSurveyError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [recent, setRecent] = useState<RuntimeSurveySummary[]>([]);

  const [connection, setConnection] = useState<ConnectionState>({
    status: "CHECKING",
    health: null,
    message: null,
    checkedAt: null,
  });

  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<RuntimeJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadErrorKind, setUploadErrorKind] =
    useState<"UPLOAD_REJECTED" | "SERVICE_UNREACHABLE" | null>(null);
  const [filmstrip, setFilmstrip] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layer, setLayer] = useState<Layer>("detections");
  const [tech, setTech] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [why, setWhy] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>("chart");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [pendingWrite, setPendingWrite] = useState<string | null>(null);
  const [writeFailure, setWriteFailure] = useState<{ id: string; message: string; retryable: boolean } | null>(null);

  const objectUrl = useRef<string | null>(null);

  const findings = useMemo(() => sortedFindings(survey?.findings ?? []), [survey]);
  const contacts = useMemo(
    () => contactViews(survey?.contacts, survey?.findings ?? []),
    [survey],
  );
  const queue = useMemo(() => reviewQueue(survey?.findings ?? []), [survey]);
  const selected = useMemo(
    () => findings.find((item) => item.detection_id === selectedId) ?? findings[0] ?? null,
    [findings, selectedId],
  );
  const track = useMemo(() => surveyTrack(survey), [survey]);
  /* The queue shrinks as verdicts land, so the active row is clamped where it is
   * read rather than resynchronised by an effect after the fact. */
  const clampedReviewIndex = queue.length === 0 ? 0 : Math.min(reviewIndex, queue.length - 1);

  /* §5.6: only real recorded positions are plotted, and the track is only the
   * real per-frame navigation fixes. Coastline and coverage swath stay null --
   * this deployment has no basemap or coverage geometry, and nothing here
   * approximates one. */
  const geometry: MapGeometry | null = useMemo(
    () => geometryFromFindings(findings, track),
    [findings, track],
  );

  /* ------------------------------------------------------------- health */

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const controller = new AbortController();

    const probe = async () => {
      try {
        const health: RuntimeHealth = await fetchHealth(controller.signal);
        if (!live) return;
        setConnection({
          status: health.status === "degraded" || !health.runtime_available ? "DEGRADED" : "ONLINE",
          health,
          message:
            health.runtime_available
              ? null
              : "The frozen detector artifact is not available on the analysis host, so no new survey can be processed.",
          checkedAt: new Date().toISOString(),
        });
        timer = window.setTimeout(probe, HEALTH_INTERVAL_OK_MS);
      } catch (cause) {
        if (!live || controller.signal.aborted) return;
        setConnection({
          status: "OFFLINE",
          health: null,
          message: failureSentence(cause),
          checkedAt: new Date().toISOString(),
        });
        timer = window.setTimeout(probe, HEALTH_INTERVAL_DOWN_MS);
      }
    };
    probe();
    return () => {
      live = false;
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  /* ------------------------------------------------ survey restore/recovery */

  /* Applied from a promise callback, never synchronously inside an effect, so a
   * load never causes a cascading render before its data has arrived. */
  const applySurvey = useCallback((id: string, value: RuntimeSurvey) => {
    setSurvey(value);
    setSurveyError(null);
    setSelectedId((current) => {
      if (value.findings.some((item) => item.detection_id === current)) return current;
      const firstContact = value.contacts?.[0];
      if (firstContact) {
        const associated = value.findings.filter((item) =>
          firstContact.source_detection_ids.includes(item.detection_id) ||
          item.detection_id === firstContact.best_observation_id,
        );
        const representative = representativeObservation(firstContact, associated);
        if (representative) return representative.detection_id;
      }
      return value.findings[0]?.detection_id ?? null;
    });
    writeStored(SURVEY_STORAGE_KEY, id);
  }, []);

  const loadSurvey = useCallback(
    (id: string, signal?: AbortSignal) =>
      fetchRuntimeSurvey(id, signal).then((value) => {
        applySurvey(id, value);
        return value;
      }),
    [applySurvey],
  );

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const id = readStored(SURVEY_STORAGE_KEY);
    const restore = id ? fetchRuntimeSurvey(id, controller.signal) : Promise.resolve(null);
    restore
      .then((value) => {
        if (!live || !value || !id) return;
        applySurvey(id, value);
      })
      .catch((cause: unknown) => {
        if (!live || controller.signal.aborted) return;
        // A record the service says is gone is genuinely gone: clear the
        // pointer. A service that could not be reached is a transient failure:
        // the pointer stays so the same survey reopens on reconnect.
        const missing = cause instanceof ApiError && cause.kind === "NOT_FOUND";
        if (missing) writeStored(SURVEY_STORAGE_KEY, null);
        setSurveyError({
          message: missing
            ? "The survey this session was working on is no longer held by the analysis service."
            : failureSentence(cause),
          retryable: !missing,
        });
      })
      .finally(() => {
        if (live) setLoadingSurvey(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [applySurvey]);

  /* The reconnect list. Refreshed whenever the service comes back, so a lost
   * session can be recovered instead of re-uploading the same raster. */
  useEffect(() => {
    if (connection.status !== "ONLINE" && connection.status !== "DEGRADED") return;
    let live = true;
    const controller = new AbortController();
    fetchRuntimeSurveyIndex(12, controller.signal)
      .then((index) => live && setRecent(index.items))
      .catch(() => {
        /* the index is a convenience; its absence is never an error state */
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [connection.status, survey?.survey_id]);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  const go = useCallback((target: Screen) => {
    setScreen(target);
  }, []);

  /* §5.7: the technical disclosure is closed on load and on every selection
   * change, so it is reset here rather than reopened by a later render. */
  const selectFinding = useCallback((finding: RuntimeFinding) => {
    setSelectedId(finding.detection_id);
    setTech(false);
  }, []);

  const openFinding = useCallback((finding: RuntimeFinding, target: Screen = "workspace") => {
    setSelectedId(finding.detection_id);
    setTech(false);
    setScreen(target);
  }, []);

  const startUpload = useCallback(() => {
    setUploadError(null);
    setUploadErrorKind(null);
    setJob(null);
    setJobId(null);
    setScreen("upload");
  }, []);

  const chooseFile = useCallback((next: File | null) => {
    setFile(next);
    setUploadError(null);
    setUploadErrorKind(null);
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
    if (next && /\.(png|jpe?g)$/i.test(next.name)) {
      const url = URL.createObjectURL(next);
      objectUrl.current = url;
      setFilmstrip(url);
    } else {
      setFilmstrip(null);
    }
  }, []);

  /* ------------------------------------------------------------ upload run */

  const runUpload = useCallback(async () => {
    if (!file) return;
    setUploadError(null);
    setUploadErrorKind(null);
    setJob(null);
    setJobId(null);
    setInFlight(true);
    setScreen("processing");
    try {
      const accepted = await uploadSurvey(file);
      setJobId(accepted.job_id);
      writeStored(JOB_STORAGE_KEY, accepted.job_id);
      // The first observable state comes straight from the accepted upload; the
      // polling effect below takes over from here.
      setJob((current) => current ?? ({
        job_id: accepted.job_id,
        survey_id: accepted.survey_id,
        state: accepted.state,
        stage: accepted.state.toLowerCase(),
        files_parsed: 0,
        images_processed: 0,
        tiles_processed: 0,
        detections_generated: 0,
        source_frame_count: accepted.source_frame_count,
        frames_completed: 0,
        steps: [],
      } as RuntimeJob));
    } catch (cause) {
      const rejected = cause instanceof ApiError && (cause.kind === "REJECTED" || cause.kind === "NOT_FOUND");
      setUploadError(failureSentence(cause));
      setUploadErrorKind(rejected ? "UPLOAD_REJECTED" : "SERVICE_UNREACHABLE");
      setInFlight(false);
    }
  }, [file]);

  /* Job polling. Runs only while a job exists and has not reached a terminal
   * state, so an idle workstation makes no requests at all. */
  useEffect(() => {
    if (!jobId) return;
    if (job && (job.state === "COMPLETED" || job.state === "FAILED")) return;
    let live = true;
    let timer: number | undefined;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const next = await fetchJob(jobId, controller.signal);
        if (!live) return;
        setJob(next);
        if (next.state === "COMPLETED" || next.state === "FAILED") {
          setInFlight(false);
          return;
        }
      } catch (cause) {
        if (!live || controller.signal.aborted) return;
        // A poll that cannot reach the service does not mean the run failed.
        // Keep polling; the connection banner already says the service is down.
        if (cause instanceof ApiError && !cause.retryable) {
          setInFlight(false);
          setUploadError(failureSentence(cause));
          setUploadErrorKind("SERVICE_UNREACHABLE");
          return;
        }
      }
      timer = window.setTimeout(poll, JOB_POLL_MS);
    };
    timer = window.setTimeout(poll, JOB_POLL_MS);
    return () => {
      live = false;
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [jobId, job]);

  /* On a completed run, load the survey it produced, then route to the role's
   * landing screen. §5.4. */
  useEffect(() => {
    if (job?.state !== "COMPLETED" || !job.survey_id) return;
    let live = true;
    const controller = new AbortController();
    const surveyId = job.survey_id;
    fetchRuntimeSurvey(surveyId, controller.signal)
      .then((value) => {
        if (!live) return;
        applySurvey(surveyId, value);
        setReviewIndex(0);
        writeStored(JOB_STORAGE_KEY, null);
      })
      .catch((cause: unknown) => {
        if (!live || controller.signal.aborted) return;
        setSurveyError({ message: failureSentence(cause), retryable: true });
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [job?.state, job?.survey_id, applySurvey]);

  useEffect(() => {
    if (screen !== "processing" || job?.state !== "COMPLETED" || !survey) return;
    if (survey.survey_id !== job.survey_id) return;
    const timer = window.setTimeout(() => setScreen(HOME[role]), 900);
    return () => window.clearTimeout(timer);
  }, [screen, job?.state, job?.survey_id, survey, role]);

  /* §7.7: verdicts are writes. The queue shows a verdict only once it lands. */
  const submitVerdict = useCallback(
    async (verdict: Verdict) => {
      const subject = queue[clampedReviewIndex] ?? queue[0];
      if (!survey || !subject) return;
      setPendingWrite(subject.detection_id);
      setWriteFailure(null);
      try {
        const event = await postReview(survey.survey_id, subject.detection_id, verdict, REVIEWER);
        setSurvey((current) =>
          current
            ? {
                ...current,
                findings: current.findings.map((item) =>
                  item.detection_id === subject.detection_id
                    ? {
                        ...item,
                        review_state: verdict,
                        review_history: [...item.review_history, event as never],
                      }
                    : item,
                ),
                contacts: current.contacts?.map((contact) =>
                  contact.source_detection_ids.includes(subject.detection_id)
                    ? {
                        ...contact,
                        reviews: {
                          history: [...(contact.reviews?.history ?? []), event as never],
                          latest_verdict: verdict,
                          review_count: (contact.reviews?.review_count ?? 0) + 1,
                        },
                      }
                    : contact,
                ),
              }
            : current,
        );
      } catch (cause) {
        setWriteFailure({
          id: subject.detection_id,
          message: failureSentence(cause),
          // A verdict is never resubmitted automatically: this log is
          // append-only, so a silent retry could record the decision twice.
          retryable: cause instanceof ApiError && cause.retryable,
        });
      } finally {
        setPendingWrite(null);
      }
    },
    [queue, clampedReviewIndex, survey],
  );

  const rasterFor = useCallback(
    (finding: RuntimeFinding | null) => {
      if (!survey || !finding) return null;
      const frame = survey.frames.find((item) => item.frame_id === finding.source_frame_id);
      if (!frame) return null;
      return rasterUrl(survey.survey_id, frame.frame_id);
    },
    [survey],
  );

  const retryLoad = useCallback(() => {
    const id = survey?.survey_id ?? readStored(SURVEY_STORAGE_KEY);
    if (!id) {
      setSurveyError({
        message: "No survey is held by this session. Upload a survey, or reopen one from the recent list.",
        retryable: false,
      });
      return;
    }
    setLoadingSurvey(true);
    loadSurvey(id)
      .catch((cause: unknown) =>
        setSurveyError({
          message: failureSentence(cause),
          retryable: !(cause instanceof ApiError && cause.kind === "NOT_FOUND"),
        }),
      )
      .finally(() => setLoadingSurvey(false));
  }, [loadSurvey, survey?.survey_id]);

  const openRecent = useCallback(
    (id: string) => {
      setLoadingSurvey(true);
      setSurveyError(null);
      loadSurvey(id)
        .then(() => {
          setReviewIndex(0);
          setScreen(HOME[role]);
        })
        .catch((cause: unknown) =>
          setSurveyError({
            message: failureSentence(cause),
            retryable: !(cause instanceof ApiError && cause.kind === "NOT_FOUND"),
          }),
        )
        .finally(() => setLoadingSurvey(false));
    },
    [loadSurvey, role],
  );

  if (screen === "landing") {
    return <LandingScreen onEntry={() => setScreen("entry")} />;
  }

  if (screen === "entry") {
    return (
      <RoleEntryScreen
        picked={picked}
        onPick={setPicked}
        onContinue={() => {
          if (!picked) return;
          setRole(picked);
          setScreen(HOME[picked]);
        }}
        onUpload={startUpload}
        onLanding={() => setScreen("landing")}
      />
    );
  }

  const body = !roleHolds(role, screen) ? (
    <PermissionScreen onChangeWorkspace={() => setScreen("entry")} />
  ) : screen === "upload" ? (
    <UploadScreen
      file={file}
      onChoose={chooseFile}
      onProcess={runUpload}
      error={uploadError}
      advanced={advanced}
      onToggleAdvanced={() => setAdvanced((value) => !value)}
      connection={connection}
    />
  ) : screen === "processing" ? (
    <ProcessingScreen
      job={job}
      inFlight={inFlight}
      error={uploadError}
      errorKind={uploadErrorKind}
      survey={survey}
      filmstripSrc={
        job?.state === "COMPLETED" && survey?.frames[0]
          ? rasterUrl(survey.survey_id, survey.frames[0].frame_id)
          : filmstrip
      }
      subtitle={
        file
          ? `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB`
          : survey
            ? `${survey.name} · ${survey.frames.length} source frames`
            : "No raster selected"
      }
      onRetry={runUpload}
      onBackToUpload={startUpload}
    />
  ) : screen === "results" ? (
    <ResultsScreen
      contacts={contacts}
      findings={findings}
      survey={survey}
      loading={loadingSurvey}
      error={surveyError}
      recent={recent}
      onOpenRecent={openRecent}
      onOpen={(finding) => openFinding(finding, role === "analyst" ? "workspace" : "map")}
      onNavigate={go}
      onRetry={retryLoad}
      onUpload={startUpload}
      title="What did we find?"
    />
  ) : screen === "map" ? (
    <MapScreen
      contacts={contacts}
      findings={findings}
      selected={selected}
      onSelect={selectFinding}
      onOpenWorkspace={() => selected && openFinding(selected, "workspace")}
      mode={mapMode}
      onMode={setMapMode}
      geometry={geometry}
      survey={survey}
      trackPoints={track.length}
    />
  ) : screen === "workspace" ? (
    <WorkspaceScreen
      survey={survey}
      contacts={contacts}
      findings={findings}
      selected={selected}
      onSelect={selectFinding}
      layer={layer}
      onLayer={setLayer}
      tech={tech}
      onToggleTech={() => setTech((value) => !value)}
      rasterFor={rasterFor}
      onSendToReview={() => setScreen("review")}
      onMap={() => setScreen("map")}
    />
  ) : screen === "review" ? (
    <ReviewScreen
      survey={survey}
      queue={queue}
      index={clampedReviewIndex}
      onIndex={setReviewIndex}
      onVerdict={submitVerdict}
      pending={pendingWrite}
      failed={writeFailure}
      rasterFor={rasterFor}
      onBackToFindings={() => setScreen("results")}
      onGenerateReport={() => setScreen("report")}
      onOpenMemory={() => setScreen("memory")}
      title="Is this finding real?"
    />
  ) : screen === "mission" ? (
    <MissionScreen
      survey={survey}
      findings={findings}
      processing={loadingSurvey}
      onOpen={(finding) => openFinding(finding, role === "analyst" ? "workspace" : "map")}
      onNavigate={go}
      closeLine={
        survey
          ? `${survey.name} · closed ${surveyTimestamp(survey)}`
          : "No survey loaded. Upload a supported sonar raster to begin."
      }
    />
  ) : screen === "decision" ? (
    <DecisionScreen
      survey={survey}
      processing={loadingSurvey}
      onNavigate={go}
      why={why}
      onToggleWhy={() => setWhy((value) => !value)}
    />
  ) : screen === "change" ? (
    <ChangeScreen survey={survey} recent={recent} />
  ) : screen === "memory" ? (
    <MemoryScreen survey={survey} />
  ) : screen === "report" ? (
    <ReportScreen survey={survey} contacts={contacts} />
  ) : screen === "lab" ? (
    <ModelLabScreen connection={connection} />
  ) : null;

  return (
    <AppShell
      role={role}
      screen={screen}
      survey={survey}
      connection={connection}
      recent={recent}
      onOpenRecent={openRecent}
      onNavigate={go}
      onLanding={() => setScreen("landing")}
      onUpload={startUpload}
      onEntry={() => setScreen("entry")}
    >
      {body}
    </AppShell>
  );
}
