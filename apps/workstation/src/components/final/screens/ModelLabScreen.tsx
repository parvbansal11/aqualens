"use client";

import { useEffect, useState } from "react";
import { Badge, Unavailable } from "../parts/Primitives";
import { ApiError, failureSentence, fetchModelCard } from "../runtime/api";
import { COPY, TITLES, UNAVAILABLE } from "../runtime/strings";
import type { ComponentHealth, ConnectionState, ModelCard } from "../runtime/types";

const CLASS_LABEL: Record<string, string> = {
  PIPELINE: "Pipeline",
  SHIPWRECK: "Wreck or structural debris",
  CRAB_POT: "Derelict fishing gear",
};

function f1(precision?: number, recall?: number) {
  if (precision === undefined || recall === undefined) return null;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function num(value: number | null | undefined, digits = 2) {
  return value === null || value === undefined ? "Unavailable" : value.toFixed(digits);
}

/** How each registered component is allowed to affect a result. Authored, fixed. */
const COMPONENT_ROLE: Record<string, { name: string; classification: string; role: string; limit: string }> = {
  yolo11s: {
    name: "Frozen YOLO11s detector",
    classification: "LEARNED",
    role: "The only candidate generator. Emits three known classes with a raw confidence.",
    limit: "Its class, confidence and box are immutable. No later stage rewrites them.",
  },
  open_set: {
    name: "Open-set memory",
    classification: "STATISTICAL",
    role: "Advisory evidence: distance from a background reference memory built from training-split background patches.",
    limit: "A high score means unusual relative to that reference, not artificial. It adds no fourth class.",
  },
  natural_clutter: {
    name: "Natural Clutter v1",
    classification: "LEARNED",
    role: "Experimental advisory provenance only.",
    limit: "Rejected as an automatic suppression gate: its false-positive reduction removed genuine baseline true positives. It can never veto a Contact.",
  },
  rfdetr: {
    name: "RF-DETR",
    classification: "UNAVAILABLE",
    role: "Optional second candidate generator.",
    limit: "No legitimately trained artifact is registered, so it is not loaded and contributes nothing.",
  },
  mask_refiner: {
    name: "Mask refiner",
    classification: "UNAVAILABLE",
    role: "Optional pixel-mask refinement over a candidate box.",
    limit: "Not configured. Rectangles are never converted into fabricated masks.",
  },
};

const AVAILABILITY_TONE: Record<string, "ok" | "warn" | "crit" | "null"> = {
  AVAILABLE: "ok",
  NOT_CONFIGURED: "null",
  UNAVAILABLE: "null",
  FAILED: "crit",
};

/**
 * §5.12 Model Lab — "How well does the system perform?".
 *
 * Two halves that a scientific reviewer needs kept apart: the frozen evaluation
 * measurements, and the live registry of what is actually loaded on this host
 * right now. Analyst only and route-guarded. Every figure traces to the frozen
 * final-v1 evaluation run served by /api/v1/runtime/model-card; every
 * availability traces to /api/v1/runtime/health.
 */
export function ModelLabScreen({ connection }: { connection: ConnectionState }) {
  const [card, setCard] = useState<ModelCard | null>(null);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    fetchModelCard(controller.signal)
      .then((value) => live && setCard(value))
      .catch((cause: unknown) => {
        if (!live || controller.signal.aborted) return;
        setError({
          message: failureSentence(cause),
          retryable: cause instanceof ApiError ? cause.retryable : true,
        });
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, []);

  const metrics = card?.metrics;
  const winner = metrics?.winner;
  const perClass = winner?.heldout_test_per_class;
  const overall = winner?.heldout_test_overall;
  const testInstances = metrics?.preflight?.test?.instances ?? {};
  const classes = metrics?.classes ?? {};
  const problemCounts = Object.values(metrics?.preflight ?? {}).map((split) => split?.problem_count);
  const leakage =
    problemCounts.length > 0 && problemCounts.every((count) => count === 0) ? "passed" : "unknown";

  const header = [
    ["Model version", card?.model ?? "unknown"],
    ["Evaluation run", metrics?.experiment ?? "unknown"],
    ["Dataset snapshot", metrics?.dataset_snapshot_id ?? "unknown"],
    ["Split", perClass ? "held-out test" : "unknown"],
    ["Leakage assertions", leakage],
  ] as const;

  /* §5.12: an unknown value in the provenance strip suppresses the metrics
   * below rather than showing unattributed numbers. */
  const attributed = header.every(([, value]) => value !== "unknown") && Boolean(perClass);

  const classIndex = Object.entries(classes).reduce<Record<string, string>>((acc, [index, name]) => {
    acc[name] = index;
    return acc;
  }, {});

  const rows = perClass
    ? Object.entries(perClass).map(([name, values]) => {
        const support = testInstances[classIndex[name]];
        return {
          label: CLASS_LABEL[name] ?? name,
          precision: values.precision,
          recall: values.recall,
          f1: f1(values.precision, values.recall),
          support,
        };
      })
    : [];

  const totalSupport = Object.values(testInstances).reduce((sum, value) => sum + (value ?? 0), 0);

  const latency = metrics?.latency;
  const device = metrics?.device;
  const health = connection.health;
  const registry: Record<string, ComponentHealth> = health?.optional_models ?? {};
  const openSet = card?.open_set ?? registry.open_set;

  return (
    <section className="sd-page sd-lab">
      <h1>{TITLES.lab}</h1>
      <p className="sd-lab-honesty">{COPY.labHonesty}</p>

      {/* --------------------------------------------- live component registry */}
      <h2 className="sd-section-heading" style={{ marginTop: 30, display: "block" }}>
        Runtime component registry
      </h2>
      <p className="sd-lab-condition">{COPY.registryIntro}</p>

      {connection.status === "OFFLINE" ? (
        <div style={{ marginTop: 12 }}>
          <Unavailable title="The analysis service is not reachable">
            {connection.message ??
              "No component availability can be reported while the service is unreachable. Nothing here is assumed."}
          </Unavailable>
        </div>
      ) : (
        <div className="sd-registry">
          {Object.entries(COMPONENT_ROLE).map(([key, meta]) => {
            const state = registry[key];
            const availability = state?.availability ?? (connection.status === "CHECKING" ? "CHECKING" : "UNAVAILABLE");
            return (
              <div className="sd-registry-row" key={key} data-availability={availability}>
                <div className="sd-registry-head">
                  <b>{meta.name}</b>
                  <Badge
                    label={availability.replace(/_/g, " ").toLowerCase()}
                    tone={AVAILABILITY_TONE[availability] ?? "null"}
                  />
                  <span className="sd-registry-class sd-mono">{meta.classification}</span>
                </div>
                <p className="sd-registry-role">{meta.role}</p>
                <p className="sd-registry-limit">{meta.limit}</p>
                {key === "yolo11s" && health ? (
                  <dl className="sd-registry-dl">
                    <div>
                      <dt>Checkpoint digest</dt>
                      <dd className="sd-mono">{health.model_sha256 ?? "Unavailable"}</dd>
                    </div>
                    <div>
                      <dt>Compute device</dt>
                      <dd className="sd-mono">{health.device}</dd>
                    </div>
                    <div>
                      <dt>Weights loaded</dt>
                      <dd className="sd-mono">{health.model_loaded ? "Yes" : "Not yet, lazy load"}</dd>
                    </div>
                    <div>
                      <dt>Known classes</dt>
                      <dd className="sd-mono">{Object.values(health.class_names ?? {}).join(", ")}</dd>
                    </div>
                  </dl>
                ) : null}
                {key === "open_set" && openSet?.availability === "AVAILABLE" ? (
                  <dl className="sd-registry-dl">
                    <div>
                      <dt>Method</dt>
                      <dd className="sd-mono">{openSet.method ?? "PATCHCORE_STYLE_OPEN_SET"}</dd>
                    </div>
                    <div>
                      <dt>Memory version</dt>
                      <dd className="sd-mono">{openSet.memory_version ?? "Unavailable"}</dd>
                    </div>
                    <div>
                      <dt>Reference vectors</dt>
                      <dd className="sd-mono">{card?.open_set?.reference_count ?? "Unavailable"}</dd>
                    </div>
                    <div>
                      <dt>Threshold</dt>
                      <dd className="sd-mono">
                        {openSet.threshold === null || openSet.threshold === undefined
                          ? "Unavailable"
                          : openSet.threshold.toFixed(4)}
                      </dd>
                    </div>
                    <div>
                      <dt>Threshold source</dt>
                      <dd className="sd-mono">{openSet.threshold_source ?? "Unavailable"}</dd>
                    </div>
                    <div>
                      <dt>Feature source</dt>
                      <dd className="sd-mono">{openSet.feature_source ?? "Unavailable"}</dd>
                    </div>
                  </dl>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {health ? (
        <div className="sd-lab-hostline sd-mono">
          {`API ${health.api_version ?? "unknown"} · detector ${health.runtime_available ? "verified against the expected digest" : "NOT verified"} · ${health.runtime_surveys_retained ?? 0} runtime surveys retained · frozen evidence run ${health.frozen_evidence_run_id ?? "unavailable"}`}
        </div>
      ) : null}

      {/* --------------------------------------------- frozen evaluation run */}
      <h2 className="sd-section-heading" style={{ marginTop: 40, display: "block" }}>
        Frozen evaluation run
      </h2>

      {loading ? (
        <div className="sd-run-header">
          {header.map(([label]) => (
            <div key={label}>
              <small>{label}</small>
              <b className="sd-mono">—</b>
            </div>
          ))}
        </div>
      ) : error || !card ? (
        <div style={{ marginTop: 20 }}>
          <Unavailable title={UNAVAILABLE.noEvaluationRun}>
            {error?.message ?? "The frozen evaluation artifact is not published by this deployment."}
          </Unavailable>
        </div>
      ) : (
        <>
          <div className="sd-run-header">
            {header.map(([label, value]) => (
              <div key={label}>
                <small>{label}</small>
                <b className="sd-mono">{value}</b>
              </div>
            ))}
          </div>

          {!attributed ? (
            <div style={{ marginTop: 28 }}>
              <Unavailable title={UNAVAILABLE.noEvaluationRun}>
                One or more provenance values are unknown for this model version, so the metrics are
                suppressed rather than shown unattributed.
              </Unavailable>
            </div>
          ) : (
            <div className="sd-lab-grid">
              <div>
                <h2 className="sd-section-heading">Detection performance by class</h2>
                <table className="sd-table">
                  <caption className="sd-table-caption">
                    Held-out test split of the frozen evaluation run. These are measurements of the frozen
                    detector, not of the workspace presentation layer.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Class</th>
                      <th scope="col" className="sd-num">Precision</th>
                      <th scope="col" className="sd-num">Recall</th>
                      <th scope="col" className="sd-num">F1</th>
                      <th scope="col" className="sd-num">Support</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.label}>
                        <th scope="row">{row.label}</th>
                        <td className="sd-num sd-mono">{num(row.precision)}</td>
                        <td className="sd-num sd-mono">{num(row.recall)}</td>
                        <td className="sd-num sd-mono">{num(row.f1)}</td>
                        <td className="sd-num sd-mono sd-support">
                          {row.support === undefined ? "Unavailable" : String(row.support)}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">All classes</th>
                      <td className="sd-num sd-mono">{num(overall?.precision)}</td>
                      <td className="sd-num sd-mono">{num(overall?.recall)}</td>
                      <td className="sd-num sd-mono">{num(f1(overall?.precision, overall?.recall))}</td>
                      <td className="sd-num sd-mono sd-support">{String(totalSupport)}</td>
                    </tr>
                  </tbody>
                </table>

                <p className="sd-lab-caveat">
                  {COPY.labCaveat} Model classes are recorded as {Object.values(classes).join(", ")}. Wreck
                  or structural debris is evaluated here as the SHIPWRECK class and its recall on the
                  held-out split is the figure shown above; the workspace applies a separate presentation
                  policy to that class, which is not a measurement and never appears here.
                </p>

                <h2 className="sd-section-heading" style={{ marginTop: 34, display: "block" }}>
                  Precision against recall
                </h2>
                <div className="sd-plot">
                  <svg viewBox="0 0 460 220" role="img" aria-label="Precision against recall">
                    <g stroke="var(--sd-border-soft)" strokeWidth="1">
                      <path d="M40,20 L440,20 M40,70 L440,70 M40,120 L440,120 M40,170 L440,170" />
                    </g>
                    <path d="M40,20 L40,170 L440,170" fill="none" stroke="var(--sd-border-strong)" strokeWidth="1" />
                    <text x="8" y="24" fontSize="10" fill="var(--sd-ink-muted)" className="sd-mono">1.0</text>
                    <text x="8" y="174" fontSize="10" fill="var(--sd-ink-muted)" className="sd-mono">0.0</text>
                    <text x="40" y="192" fontSize="10" fill="var(--sd-ink-muted)" className="sd-mono">recall 0.0</text>
                    <text x="398" y="192" fontSize="10" fill="var(--sd-ink-muted)" className="sd-mono">1.0</text>
                  </svg>
                  <div style={{ paddingTop: 10 }}>
                    <Unavailable title={UNAVAILABLE.prCurveTitle}>{UNAVAILABLE.prCurveBody}</Unavailable>
                  </div>
                </div>
              </div>

              <aside className="sd-lab-aside">
                <div>
                  <h2>Open-set evaluation</h2>
                  <p>{COPY.openSetIntro}</p>
                  <div style={{ marginTop: 12 }}>
                    <Unavailable title={UNAVAILABLE.openSetTitle}>{UNAVAILABLE.openSetBody}</Unavailable>
                  </div>
                  <p className="sd-lab-condition">{COPY.openSetRuntimeNote}</p>
                </div>
                <div>
                  <h2>Latency</h2>
                  {latency ? (
                    <>
                      <div className="sd-lab-rows">
                        <div className="sd-lab-row">
                          <span>Per source frame, mean</span>
                          <b className="sd-mono">{`${(latency.mean_ms ?? 0).toFixed(1)} ms`}</b>
                        </div>
                        <div className="sd-lab-row">
                          <span>Per source frame, median</span>
                          <b className="sd-mono">{`${(latency.median_ms ?? 0).toFixed(1)} ms`}</b>
                        </div>
                        <div className="sd-lab-row">
                          <span>95th percentile</span>
                          <b className="sd-mono">{`${(latency.p95_ms ?? 0).toFixed(1)} ms`}</b>
                        </div>
                      </div>
                      {/* Never show a latency figure without its condition. */}
                      <p className="sd-lab-condition">
                        {`Measured on ${device?.gpu ?? "an unrecorded device"}, ${latency.n_images ?? "an unrecorded number of"} images, single stream. Peak memory was not recorded for this run.`}
                        {health ? ` This deployment runs on ${health.device}, so its timings will differ.` : ""}
                      </p>
                    </>
                  ) : (
                    <Unavailable title="Latency unavailable">
                      The frozen evaluation run does not publish latency measurements.
                    </Unavailable>
                  )}
                </div>
                <div>
                  <h2>Review lineage</h2>
                  <p>{COPY.reviewLineage}</p>
                </div>
                <div>
                  <h2>Checkpoint</h2>
                  <div className="sd-lab-rows">
                    <div className="sd-lab-row">
                      <span>Wreck class status</span>
                      <b className="sd-mono">{card.shipwreck_status}</b>
                    </div>
                    <div className="sd-lab-row">
                      <span>Evaluated digest matches host</span>
                      <b className="sd-mono">
                        {health?.model_sha256 && card.checkpoint_sha256
                          ? health.model_sha256 === card.checkpoint_sha256
                            ? "Yes"
                            : "No"
                          : "Unavailable"}
                      </b>
                    </div>
                  </div>
                  <p className="sd-lab-condition sd-mono" style={{ wordBreak: "break-all" }}>
                    {card.checkpoint_sha256 ?? "Checkpoint digest unavailable"}
                  </p>
                </div>
              </aside>
            </div>
          )}
        </>
      )}
    </section>
  );
}
