"use client";

import { useEffect, useRef, useState } from "react";
import { Unavailable } from "../parts/Primitives";
import { BUTTONS, COPY, TITLES } from "../runtime/strings";
import { zipEntryBasenames } from "../runtime/zip-peek";
import type { ConnectionState } from "../runtime/types";

const ACCEPTED = [".png", ".jpg", ".jpeg", ".pbm", ".zip"];

function extensionOf(name: string) {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index).toLowerCase();
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * §5.3 Upload — "What survey do you want analyzed?"
 *
 * Binding note: a ZIP bundle may carry navigation.csv and mission.json
 * alongside its rasters (packages/sagar/perception/navigation.py). This screen
 * detects their presence client-side, before any network call, by reading the
 * ZIP's central directory (no decompression, see runtime/zip-peek.ts) -- it
 * shows what the bundle contains, not that the backend has validated it yet.
 * A single raster (no ZIP) can never carry either file, so those rows fall
 * back to their honest unavailable/optional state. The primary gate stays on
 * imagery: nothing here claims a capability the pipeline does not have.
 */
export function UploadScreen({
  file,
  onChoose,
  onProcess,
  error,
  advanced,
  onToggleAdvanced,
  connection,
}: {
  file: File | null;
  onChoose: (file: File | null) => void;
  onProcess: () => void;
  error: string | null;
  advanced: boolean;
  onToggleAdvanced: () => void;
  connection: ConnectionState;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [bundleEntries, setBundleEntries] = useState<Set<string> | null>(null);

  const extension = file ? extensionOf(file.name) : "";
  const unreadable = Boolean(file) && !ACCEPTED.includes(extension);
  const imageryOk = Boolean(file) && !unreadable;
  const isBundle = extension === ".zip";

  useEffect(() => {
    if (!file || !isBundle) return;
    let cancelled = false;
    zipEntryBasenames(file).then((names) => {
      if (!cancelled) setBundleEntries(names);
    });
    return () => {
      cancelled = true;
    };
  }, [file, isBundle]);

  const hasNavigation = isBundle && Boolean(bundleEntries?.has("navigation.csv"));
  const hasMission = isBundle && Boolean(bundleEntries?.has("mission.json"));
  const serviceReady = connection.status === "ONLINE";
  const serviceBlocked = connection.status === "OFFLINE" || connection.status === "DEGRADED";

  const requirements = [
    {
      name: "Analysis service",
      detail:
        connection.status === "ONLINE"
          ? `Connected. Inference runs on ${connection.health?.device ?? "the analysis host"} against the verified frozen checkpoint.`
          : connection.status === "CHECKING"
            ? "Contacting the analysis service."
            : (connection.message ?? "The analysis service is not reachable from this browser."),
      reason: null,
      state:
        connection.status === "ONLINE"
          ? "Connected"
          : connection.status === "CHECKING"
            ? "Checking"
            : connection.status === "DEGRADED"
              ? "Degraded"
              : "Unreachable",
      ok: serviceReady,
      tone: connection.status === "OFFLINE" ? "crit" : undefined,
    },
    {
      name: "Sonar imagery",
      detail: file
        ? `${file.name} · ${humanSize(file.size)}`
        : "One raster, or a prepared bundle of rasters",
      reason: unreadable
        ? `Upload must be PNG, JPEG, PBM, or a prepared ZIP bundle. This deployment cannot read "${extension || "a file with no extension"}".`
        : null,
      state: unreadable ? "Unreadable" : imageryOk ? "Loaded" : "Waiting",
      ok: imageryOk,
      tone: unreadable ? "crit" : undefined,
    },
    {
      name: "Navigation metadata",
      detail: hasNavigation
        ? "navigation.csv detected in this bundle. Frames it references will carry a latitude and longitude."
        : isBundle
          ? "No navigation.csv in this bundle. Findings from this upload carry no latitude or longitude."
          : "A single raster cannot carry navigation.csv. Findings from this upload carry no latitude or longitude.",
      reason: null,
      state: hasNavigation ? "Loaded" : "Unavailable",
      ok: hasNavigation,
      tone: undefined,
    },
    {
      name: "Mission metadata",
      detail: hasMission
        ? "mission.json detected in this bundle. Its survey_name will be used, when present."
        : "The survey name is taken from the uploaded file name.",
      reason: null,
      state: hasMission ? "Loaded" : "Optional",
      ok: hasMission,
      tone: undefined,
    },
  ];

  function accept(files: FileList | null) {
    onChoose(files && files.length > 0 ? files[0] : null);
  }

  return (
    <section className="sd-page sd-upload">
      <h1>{TITLES.upload}</h1>
      <p className="sd-page-sub">{COPY.uploadSub}</p>

      <div
        className="sd-dropzone"
        data-over={over}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          accept(event.dataTransfer.files);
        }}
      >
        <input
          ref={input}
          type="file"
          accept={ACCEPTED.join(",")}
          onChange={(event) => accept(event.target.files)}
        />
        {file && imageryOk ? (
          <div className="sd-dropzone-ready" onClick={(event) => event.stopPropagation()}>
            <div className="sd-dropzone-disc"><i /></div>
            <b>Ready to process</b>
            <p>{`${file.name} · ${humanSize(file.size)}${isBundle && bundleEntries ? ` · ${bundleEntries.size} bundle entries` : ""}`}</p>
            <div>
              <button type="button" className="sd-btn-secondary" onClick={() => input.current?.click()}>Replace</button>
              <button type="button" className="sd-btn-tertiary" onClick={() => onChoose(null)}>Remove</button>
            </div>
          </div>
        ) : (
          <>
            <div className="sd-dropzone-disc"><i /></div>
            <b>{COPY.dropzoneTitle}</b>
            <p>{COPY.dropzoneLine}</p>
            <button type="button" className="sd-btn-secondary" onClick={(event) => { event.stopPropagation(); input.current?.click(); }}>
              {BUTTONS.chooseFiles}
            </button>
            <p className="sd-dropzone-ext sd-mono">{COPY.dropzoneExtensions}</p>
          </>
        )}
      </div>

      <h2 className="sd-eyebrow sd-requirements-title">{COPY.requirementsTitle}</h2>
      <div className="sd-requirements">
        {requirements.map((item) => (
          <div className="sd-requirement" key={item.name} data-ok={item.ok} data-tone={item.tone}>
            <i />
            <div>
              <b>{item.name}</b>
              <span>{item.detail}</span>
              {item.reason ? <span className="sd-requirement-reason">{item.reason}</span> : null}
            </div>
            <em>{item.state}</em>
          </div>
        ))}
      </div>

      {serviceBlocked ? (
        <div style={{ marginTop: 20 }}>
          <Unavailable
            title={
              connection.status === "OFFLINE"
                ? "The analysis service is not reachable"
                : "The analysis service is degraded"
            }
          >
            {connection.message ??
              "No new survey can be processed until the analysis service answers. Nothing you select here is sent or changed in the meantime."}
          </Unavailable>
        </div>
      ) : null}

      {error ? (
        <div className="sd-upload-error" role="alert" style={{ marginTop: 20 }}>
          <p className="sd-error">{error}</p>
          <p className="sd-advanced-note">
            Nothing was processed and no survey record was created. Correct the file, or choose a different
            one, and process again.
          </p>
        </div>
      ) : null}

      <div className="sd-upload-actions">
        <button
          type="button"
          className="sd-btn-primary"
          disabled={!imageryOk || connection.status === "OFFLINE"}
          onClick={onProcess}
        >
          {BUTTONS.processSurvey}
        </button>
        <button type="button" className="sd-btn-tertiary" onClick={onToggleAdvanced}>
          {advanced ? BUTTONS.advancedClose : BUTTONS.advancedOpen}
        </button>
      </div>

      {advanced ? (
        <div className="sd-advanced">
          <div className="sd-advanced-grid">
            <div>
              <small>Along-track window</small>
              <b className="sd-mono">768 px tiles · 30% overlap</b>
              <span>Applied only to wide or large rasters. Smaller rasters run whole-frame.</span>
            </div>
            <div>
              <small>Pre-inference filtering</small>
              <b className="sd-mono">None</b>
              <span>The raster is decoded to RGB without denoising or normalisation.</span>
            </div>
            <div>
              <small>Detection threshold</small>
              <b className="sd-mono">0.12 on the tiled path</b>
              <span>Ultralytics defaults apply on the whole-frame path. The threshold is never tuned per upload.</span>
            </div>
            <div>
              <small>Open-set evidence</small>
              <b className="sd-mono">
                {connection.health?.optional_models?.open_set?.availability ?? "Unknown"}
              </b>
              <span>Advisory dissimilarity from a background reference memory. It adds no class.</span>
            </div>
          </div>
          <p className="sd-advanced-note">{COPY.advancedCaution}</p>
        </div>
      ) : null}
    </section>
  );
}
