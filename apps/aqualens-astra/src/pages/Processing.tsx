import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Check,
  ArrowRight,
  FileArchive,
  Circle,
  LoaderCircle,
} from "lucide-react";
import { useWorkspace } from "../lib/store";
import { getJob, getSurvey, RuntimeError } from "../lib/runtime/api";
import { presentationPhases } from "../fixtures/processing";
import { SectionHeading, IllustrativeNote } from "../components/ui";
const labels: Record<string, string> = {
  upload_decoded: "Preparing survey",
  metadata_read: "Reading survey context",
  detector_ready: "Preparing the detector",
  inference: "Analysing sonar",
  condition: "Assessing sonar condition",
  open_set: "Checking unusual patterns",
  contact_fusion: "Linking observations",
  evidence: "Assembling evidence",
  report: "Preparing the record",
};
export default function Processing() {
  const {
    job,
    jobId,
    jobSurveyId,
    setJob,
    completeJob,
    pendingFilename,
    openSurvey,
    survey,
  } = useWorkspace();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const demo = params.get("preview") === "1";
  const [step, setStep] = useState(1),
    [error, setError] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  const done = demo
    ? step >= presentationPhases.length
    : job?.state === "COMPLETED" && survey?.id === job.survey_id;
  useEffect(() => {
    if (demo || !jobId) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    let completedSurveyId: string | null = null;
    const loadResult = async (id: string) => {
      const s = await getSurvey(id);
      if (active) {
        completeJob(s);
        navigate("/roles", { replace: true });
      }
    };
    const poll = async () => {
      try {
        if (!completedSurveyId) {
          const next = await getJob(jobId);
          if (!active) return;
          setJob(next);
          setError(null);
          if (next.state === "FAILED") return;
          if (next.state === "COMPLETED") completedSurveyId = next.survey_id;
        }
        if (completedSurveyId) {
          // Completion stops job polling. A transient record-read failure retries only that GET.
          await loadResult(completedSurveyId);
          return;
        }
      } catch (e) {
        if (
          e instanceof RuntimeError &&
          e.status === 404 &&
          !completedSurveyId
        ) {
          // Jobs are in-memory; completed surveys are durable across backend restarts.
          if (jobSurveyId) {
            try {
              await loadResult(jobSurveyId);
              return;
            } catch {
              /* Retain the job identity for recovery. */
            }
          }
          if (active)
            setError(
              "This job is no longer retained by the service. Check recent surveys or retry status; the upload will not be resubmitted.",
            );
          return;
        }
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "The service could not be reached.",
          );
      }
      if (active) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // The job ID and explicit retry own the poll lifecycle; context callbacks only commit data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, jobSurveyId, demo, retry]);
  const steps = demo
    ? presentationPhases.map(([id, label], i) => ({
        id,
        label,
        state: i < step ? "done" : i === step ? "running" : "queued",
      }))
    : (job?.steps ?? []);
  return (
    <main
      id="main-content"
      className="workspace-main focused-page processing-page"
    >
      <div className="processing-kicker">
        {demo ? (
          <IllustrativeNote />
        ) : (
          <span className="eyebrow">SURVEY / PROCESSING</span>
        )}
      </div>
      <SectionHeading
        title={
          done
            ? "The picture is coming together."
            : job?.state === "FAILED"
              ? "This survey needs attention."
              : "Every observation has a place."
        }
      />
      <p className="page-description">
        {demo
          ? "A manual walkthrough of the processing states. No inference is running."
          : done
            ? "Your source imagery and Contact records are ready to inspect."
            : "The analysis service reports each phase as it happens."}
      </p>
      <div className="processing-file">
        <FileArchive size={24} />
        <div>
          <strong>
            {demo
              ? "Illustrative survey"
              : pendingFilename || job?.upload?.filename || "Survey job"}
          </strong>
          <span>
            {demo ? "PROCESSING PREVIEW" : (job?.state ?? "AWAITING SERVICE")}
          </span>
        </div>
        {done ? <Check size={21} /> : <span className="acoustic-progress" />}
      </div>
      <div className="processing-track">
        {steps.map((s) => (
          <div key={s.id} className={`processing-step step-${s.state}`}>
            <span className="phase-icon">
              {s.state === "done" ? (
                <Check size={17} />
              ) : s.state === "running" ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Circle size={8} />
              )}
            </span>
            <span>{labels[s.id] ?? s.label}</span>
            <span className="phase-state">
              {s.state === "done"
                ? "Complete"
                : s.state === "running"
                  ? "In progress"
                  : s.state === "queued"
                    ? ""
                    : s.state}
            </span>
          </div>
        ))}
      </div>
      {!demo &&
        job?.source_frame_count != null &&
        job.frames_completed != null && (
          <p className="processing-count">
            {job.frames_completed} of {job.source_frame_count} source frames
            processed
          </p>
        )}
      {!demo && job?.error && (
        <p role="alert" className="error-message">
          {job.error.message}
        </p>
      )}
      {error && (
        <div role="alert" className="error-message">
          {error}
          <button className="text-link" onClick={() => setRetry((v) => v + 1)}>
            Retry status
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      {!demo && !jobId && (
        <p>
          No active processing job.{" "}
          <Link to="/workspace/upload">Choose a survey to begin.</Link>
        </p>
      )}
      <div className="processing-actions">
        {demo && (
          <button className="text-link" onClick={() => setStep(0)}>
            Restart preview
          </button>
        )}
        {demo && !done && (
          <button className="button" onClick={() => setStep((v) => v + 1)}>
            Next phase
            <ArrowRight size={17} />
          </button>
        )}
        {done && (
          <Link
            className="button"
            to="/roles"
            onClick={() => {
              if (demo) void openSurvey("epitomeNavigated");
            }}
          >
            Choose your station
            <ArrowRight size={17} />
          </Link>
        )}
      </div>
      <p className="processing-footnote">
        {demo
          ? "Preview states are advanced by you; they do not represent elapsed work."
          : "Progress reflects reported analysis service events."}
      </p>
    </main>
  );
}
