import { useState } from "react";
import { useStore } from "../state/store";
import { API_BASE } from "../api/config";
import { api } from "../api/client";
import type { CapabilityStatus, EvidenceStatus } from "../api/types";
import { analystLabel, CLASS_LABEL } from "../api/labels";
import { Empty, Icon, Skeleton, StateGlyph } from "../components/ui";

const CAP_LABEL: Record<string, string> = {
  known_target_detection: "Known target detection",
  shipwreck_supervised: "Shipwreck, supervised",
  shipwreck_demo_recovery: "Shipwreck recovery heuristic",
  local_anomaly: "Local anomaly",
  water_column: "Water column",
  persistence: "Persistence",
  raised_relief: "Raised relief",
  navigation: "Navigation",
  contact_localization: "Contact localization",
  metric_depth: "Metric depth",
  metric_height: "Metric height",
  material_classification: "Material classification",
  reporting: "Reporting",
  deployment: "Deployment",
};
const CAP_ORDER = Object.keys(CAP_LABEL);

const STATUS: Record<CapabilityStatus, string> = {
  IMPLEMENTED_AND_VALIDATED: "Validated",
  IMPLEMENTED_NOT_VALIDATED: "Implemented, not validated",
  PROVISIONAL: "In research",
  UNAVAILABLE: "Not available",
  NOT_APPLICABLE: "Not applicable",
};
const AVAIL: Record<EvidenceStatus, string> = { AVAILABLE: "Available", UNAVAILABLE: "Unavailable", NOT_VALIDATED: "Not yet validated", NOT_APPLICABLE: "Off", FAILED: "Failed evaluation" };
const MODE: Record<string, string> = { ANALYST_ONLY: "Analyst only", CONDITIONAL: "Per Contact", OFF: "Off", ON: "On", LOCAL_WORKSTATION: "Local workstation" };

export function System() {
  const { state, refreshSystem } = useStore();
  const [metrics, setMetrics] = useState(false);
  const p = state.provenance;
  const caps = state.capabilities;
  const r = state.readiness;

  if (!p || !caps) {
    if (!state.online)
      return (
        <Empty
          title="Backend unavailable"
          action={
            <button className="btn btn--primary" onClick={() => void refreshSystem()}>
              <Icon name="refresh" size={14} /> Retry
            </button>
          }
        >
          Aqualens could not reach the local processing service.
        </Empty>
      );
    return (
      <div className="page page--narrow">
        <Skeleton lines={6} />
      </div>
    );
  }

  const heldOut = p.evaluation.held_out_test_per_class;
  const services: [string, boolean | undefined][] = r
    ? [
        ["API", r.services.api],
        ["Database", r.services.database],
        ["Storage", r.services.storage],
        ["Detector", r.services.detector],
        ["Reporting", r.services.reporting],
      ]
    : [];

  return (
    <div className="page page--narrow">
      <header className="page__head">
        <p className="page__eyebrow">System details</p>
        <h1 className="page__title">What produced this evidence</h1>
        <p className="page__lede">Read live from the local Aqualens service. Readiness says the service can run; capability says what the science supports today.</p>
      </header>

      <section className="block" aria-labelledby="sys-ready">
        <h2 id="sys-ready" className="block__title">
          Readiness
        </h2>
        <ul className="svc svc--row">
          {services.map(([name, ok]) => (
            <li key={name}>
              <StateGlyph state={ok ? "AVAILABLE" : "UNAVAILABLE"} />
              <span className="svc__name">{name}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">
          {r?.status === "READY" ? "Local system ready." : "Local system not ready."} {r?.detector_loaded ? "Detector loaded." : "The detector loads on first inference."} {API_BASE}
        </p>
      </section>

      <section className="block" aria-labelledby="sys-model">
        <h2 id="sys-model" className="block__title">
          Detector
        </h2>
        <dl className="kv">
          <div>
            <dt>Model</dt>
            <dd className="mono">{p.model_id}</dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd className="mono">{p.model_sha}</dd>
          </div>
          <div>
            <dt>Machine classes</dt>
            <dd>{p.machine_classes.map((c) => CLASS_LABEL[c]).join(" · ")}</dd>
          </div>
          <div>
            <dt>Shipwreck recovery</dt>
            <dd>
              {p.shipwreck_recovery ? "Enabled" : "Disabled on this path"} · {p.shipwreck_recovery_invocations} invocations since start
            </dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>Frozen. Nothing learns online; analyst verdicts are stored as review history and never applied to the model.</dd>
          </div>
        </dl>
        <button className="disclose" aria-expanded={metrics} onClick={() => setMetrics((m) => !m)}>
          <Icon name={metrics ? "chevronDown" : "chevronRight"} size={12} /> Held-out evaluation per class
        </button>
        {metrics && heldOut && (
          <div className="metrics">
            <table className="table">
              <thead>
                <tr>
                  <th>Class</th>
                  <th className="num">Precision</th>
                  <th className="num">Recall</th>
                  <th className="num">AP50</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(heldOut).map(([cls, m]) => (
                  <tr key={cls}>
                    <td>{CLASS_LABEL[cls as keyof typeof CLASS_LABEL] ?? cls}</td>
                    <td className="num">{m.precision.toFixed(2)}</td>
                    <td className="num">{m.recall.toFixed(2)}</td>
                    <td className="num">{m.ap50.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">{p.evaluation.note} Shipwreck precision is degenerate at zero recall.</p>
          </div>
        )}
      </section>

      <section className="block" aria-labelledby="sys-cap">
        <h2 id="sys-cap" className="block__title">
          Capabilities
        </h2>
        <ul className="caps">
          {[...CAP_ORDER.filter((k) => caps[k]), ...Object.keys(caps).filter((k) => !CAP_LABEL[k])].map((k) => {
            const c = caps[k];
            return (
              <li key={k} className={`cap cap--${c.availability.toLowerCase()}`}>
                <StateGlyph state={c.availability === "FAILED" ? "UNAVAILABLE" : c.availability} />
                <span className="cap__name">{CAP_LABEL[k] ?? k}</span>
                <span className="cap__state">
                  {AVAIL[c.availability]}
                  {c.mode ? ` · ${MODE[c.mode] ?? c.mode}` : ""}
                </span>
                <span className="cap__status">{STATUS[c.status]}</span>
                <span className="cap__reason">{c.reason}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="block" aria-labelledby="sys-sem">
        <h2 id="sys-sem" className="block__title">
          Semantics
        </h2>
        <dl className="kv">
          <div>
            <dt>Contact</dt>
            <dd>One physical-object hypothesis. Association policy {p.association_policy}.</dd>
          </div>
          <div>
            <dt>Analyst classes</dt>
            <dd>{p.analyst_classes.map(analystLabel).join(" · ")}. Human judgements, never machine predictions.</dd>
          </div>
          <div>
            <dt>People</dt>
            <dd>Names in history are declared by the working view. This workstation has no sign-in.</dd>
          </div>
          <div>
            <dt>Build</dt>
            <dd className="mono">
              {p.build_version ? p.build_version.slice(0, 12) : "Unavailable"}
              {p.working_tree_modified_at_start ? " · modified working tree" : ""} · API {p.api_version}
            </dd>
          </div>
          <div>
            <dt>Contract</dt>
            <dd>
              <a className="link" href={api.openApiUrl} target="_blank" rel="noreferrer">
                OpenAPI
              </a>
            </dd>
          </div>
        </dl>
      </section>

      <section className="block" aria-labelledby="sys-lim">
        <h2 id="sys-lim" className="block__title">
          Limitations
        </h2>
        <ul className="limits">
          {p.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
