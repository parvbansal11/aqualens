import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Upload as UploadIcon,
  ArrowRight,
  FileArchive,
  FileImage,
  Check,
  X,
  LoaderCircle,
  Navigation,
  FolderOpen,
  ArrowLeft,
} from "lucide-react";
import { useWorkspace } from "../lib/store";
import { inspectUpload } from "../lib/runtime/upload";
import { uploadSurvey, configured } from "../lib/runtime/api";
import { SectionHeading } from "../components/ui";
export default function Upload({ intake = false }: { intake?: boolean }) {
  const {
    selection,
    setSelection,
    rememberJob,
    connection,
    recent,
    openSurvey,
    loadError,
  } = useWorkspace();
  const [error, setError] = useState<string | null>(null),
    [validating, setValidating] = useState(false),
    [sending, setSending] = useState(false),
    [drag, setDrag] = useState(false),
    [filename, setFilename] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  const navigate = useNavigate();
  async function choose(file: File | undefined) {
    if (!file) return;
    const ticket = ++version.current;
    setError(null);
    setValidating(true);
    setFilename(file.name);
    setSelection(null);
    try {
      const result = await inspectUpload(file);
      if (ticket === version.current) setSelection(result);
      else if (result.preview) URL.revokeObjectURL(result.preview);
    } catch (e) {
      if (ticket === version.current)
        setError(
          e instanceof Error ? e.message : "This file could not be read.",
        );
    } finally {
      if (ticket === version.current) setValidating(false);
    }
  }
  async function process() {
    if (!selection || sending) return;
    setSending(true);
    setError(null);
    try {
      const accepted = await uploadSurvey(selection.file);
      rememberJob(accepted, selection.file.name);
      navigate("/intake/processing");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The upload could not be accepted.",
      );
    } finally {
      setSending(false);
    }
  }
  return (
    <main id="main-content" className="workspace-main focused-page upload-page">
      <Link className="text-link back-link" to={intake ? "/" : "/workspace"}>
        <ArrowLeft size={15} />
        {intake ? "Back to the ocean" : "Workspace"}
      </Link>
      <SectionHeading
        eyebrow="SURVEY / INTAKE"
        title={intake ? "Start with the survey." : "Start with the source."}
      />
      <p className="page-description">
        Add a sonar raster or a prepared survey bundle.
      </p>
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        accept=".png,.jpg,.jpeg,.pbm,.zip"
        aria-label="Choose sonar survey file"
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      <div
        className={`upload-surface ${drag ? "dragging" : ""} ${selection ? "has-file" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length > 1)
            setError("Choose one raster or combine the survey in one ZIP.");
          else void choose(e.dataTransfer.files[0]);
        }}
      >
        {selection ? (
          <div className="selected-file">
            <div className="selected-file-preview">
              {selection.preview ? (
                <img
                  src={selection.preview}
                  alt={`Selected sonar file ${selection.file.name}`}
                />
              ) : (
                <FileArchive size={48} strokeWidth={1} />
              )}
              <span>
                <Check size={13} /> FILE SELECTED
              </span>
            </div>
            <div className="selected-file-info">
              <p className="eyebrow">YOUR SURVEY</p>
              <h2>{selection.file.name}</h2>
              <p>
                {(selection.file.size / 1024 / 1024).toFixed(2)} MB
                <span>·</span>
                {selection.file.type ||
                  selection.file.name.split(".").pop()?.toUpperCase()}
              </p>
              <div className="file-contents">
                <span>
                  <FileImage size={17} />
                  {selection.rasterCount} sonar{" "}
                  {selection.rasterCount === 1 ? "frame" : "frames"}
                </span>
                {selection.navigation && (
                  <span>
                    <Navigation size={16} />
                    Navigation
                  </span>
                )}
                {selection.mission && (
                  <span>
                    <FolderOpen size={17} />
                    Mission metadata
                  </span>
                )}
              </div>
              {selection.entries && (
                <details>
                  <summary>View bundle contents</summary>
                  <ul>
                    {selection.entries.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </details>
              )}
              <button
                className="text-link"
                onClick={() => input.current?.click()}
              >
                Choose another file
                <ArrowRight size={15} />
              </button>
            </div>
            <button
              className="icon-button remove-file"
              aria-label="Remove selected file"
              onClick={() => {
                setSelection(null);
                setFilename("");
                if (input.current) input.current.value = "";
              }}
            >
              <X size={18} />
            </button>
          </div>
        ) : validating ? (
          <div className="validating-file" role="status">
            <LoaderCircle className="spin" size={30} />
            <h2>{filename}</h2>
            <p>Checking the selected file…</p>
          </div>
        ) : (
          <button
            className="drop-target"
            onClick={() => input.current?.click()}
          >
            <span className="upload-echo">
              <UploadIcon size={28} strokeWidth={1.5} />
            </span>
            <h2>Drop your survey here.</h2>
            <p>or browse files on this computer</p>
            <span className="file-formats">PNG · JPEG · PBM · ZIP</span>
          </button>
        )}
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <div className="upload-bottom">
        <div>
          {!configured ? (
            <>
              <p className="small-heading">Analysis Service offline</p>
              <p>
                {selection
                  ? "Your file is selected locally. Processing needs a connected analysis service."
                  : "Files stay on this computer until an analysis service is connected."}
              </p>
            </>
          ) : (
            <>
              <p className="small-heading">
                {selection
                  ? "Ready for service validation"
                  : "Source files stay the source"}
              </p>
              <p>
                {selection
                  ? "The service validates rasters and supplied metadata before queuing."
                  : "Original pixels are preserved through analysis."}
              </p>
            </>
          )}
        </div>
        <button
          className="button"
          disabled={
            !selection ||
            sending ||
            !configured ||
            connection !== "Service connected"
          }
          onClick={() => void process()}
        >
          {sending ? <LoaderCircle size={17} className="spin" /> : null}
          {sending ? "Validating with service" : "Process Survey"}
          <ArrowRight size={17} />
        </button>
      </div>
      <div className="upload-notes">
        <details>
          <summary>What can I include?</summary>
          <p>
            PNG, JPEG, or PBM rasters. ZIP bundles may include navigation.csv
            and mission.json. Navigation must match source filenames.
          </p>
          <p>
            Latitude, longitude, and heading are supplied metadata. The current
            runtime does not expose depth.
          </p>
        </details>
        <Link className="text-link" to="/intake/processing?preview=1">
          Preview processing states
          <ArrowUpRightIcon />
        </Link>
      </div>
      {intake && (
        <section className="intake-recent">
          <div className="row-heading">
            <h2>Open a survey</h2>
            <span>CHOOSE THE CONTEXT. THEN YOUR STATION.</span>
          </div>
          {loadError && (
            <p role="alert" className="error-message">
              {loadError}
            </p>
          )}
          <div className="recent-list">
            {recent.map((s) => (
              <button
                className="recent-survey"
                key={s.id}
                onClick={async () => {
                  if (await openSurvey(s.id)) navigate("/roles");
                }}
              >
                <FileArchive size={22} />
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.frames} frames · {s.contacts} Contacts
                  </small>
                </span>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>
          <details className="presentation-choices">
            <summary>Explore an illustrative survey</summary>
            <p>
              Real sonar with explicitly illustrative evidence. No inference is
              run.
            </p>
            <div className="recent-list">
              {[
                ["epitomeNavigated", "Harbour approach"],
                ["epitomeNoNavigation", "Sonar only"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className="recent-survey"
                  onClick={async () => {
                    if (await openSurvey(id)) navigate("/roles");
                  }}
                >
                  <FileImage size={20} />
                  <span>
                    <strong>{label}</strong>
                    <small>ILLUSTRATIVE</small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              ))}
            </div>
          </details>
        </section>
      )}
    </main>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={15} style={{ transform: "rotate(-45deg)" }} />;
}
