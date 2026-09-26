import { FlaskConical } from "lucide-react";
import { configured } from "../lib/runtime/api";
import { useRemote } from "../lib/runtime/useRemote";
import type { RuntimeHealth, ModelCard } from "../lib/runtime/wire";
import { SectionHeading, Empty } from "../components/ui";
export default function ModelLab() {
  const health = useRemote<RuntimeHealth>(
      configured ? "/runtime/health" : null,
    ),
    card = useRemote<ModelCard>(configured ? "/runtime/model-card" : null);
  const names: Record<string, string> = {
    yolo11s: "YOLO11s",
    open_set: "Open-set evidence",
    natural_clutter: "Natural Clutter",
    rfdetr: "RF-DETR",
    mask_refiner: "Mask refiner",
  };
  return (
    <main id="main-content" className="workspace-main model-page">
      <SectionHeading
        eyebrow="FROZEN MODELS / OBSERVED RUNTIME"
        title="Model Lab"
      >
        <FlaskConical size={29} strokeWidth={1} />
      </SectionHeading>
      <p className="page-description">
        A transparent view of the instruments behind the evidence.
      </p>
      {!configured && (
        <Empty title="Connect the analysis service.">
          <p>Model availability comes from the runtime health record.</p>
        </Empty>
      )}
      {health.loading && <p role="status">Reading runtime registry…</p>}
      {health.error && (
        <p role="alert" className="error-message">
          {health.error}
          <button className="text-link" onClick={health.reload}>
            Retry health
          </button>
        </p>
      )}
      {health.data && (
        <>
          <div className="registry-meta">
            <span>
              Device <b className="mono">{health.data.device}</b>
            </span>
            <span>
              Detector{" "}
              <b>
                {health.data.model_loaded
                  ? "Loaded"
                  : "Loads with the next job"}
              </b>
            </span>
            <span>
              Known classes{" "}
              <b>{Object.values(health.data.class_names).join(" · ")}</b>
            </span>
          </div>
          <div className="model-registry">
            {Object.entries(health.data.optional_models).map(([key, c]) => (
              <details key={key}>
                <summary>
                  <strong>{names[key] ?? key}</strong>
                  <span>
                    {c.availability.replace(/_/g, " ")}
                    {key === "natural_clutter" ? " · ADVISORY ONLY" : ""}
                  </span>
                </summary>
                <dl>
                  <div>
                    <dt>Role</dt>
                    <dd>{c.role?.replace(/_/g, " ")}</dd>
                  </div>
                  {key === "yolo11s" && (
                    <div>
                      <dt>Checkpoint SHA-256</dt>
                      <dd className="mono">{health.data!.model_sha256}</dd>
                    </div>
                  )}
                  {key === "natural_clutter" && (
                    <div>
                      <dt>Automatic suppression</dt>
                      <dd>Not permitted</dd>
                    </div>
                  )}
                  {c.memory_version && (
                    <div>
                      <dt>Reference memory</dt>
                      <dd className="mono">{c.memory_version}</dd>
                    </div>
                  )}
                  {c.threshold != null && (
                    <div>
                      <dt>Anomaly threshold</dt>
                      <dd className="mono">{c.threshold}</dd>
                    </div>
                  )}
                  {c.threshold_source && (
                    <div>
                      <dt>Threshold source</dt>
                      <dd className="mono">{c.threshold_source}</dd>
                    </div>
                  )}
                  {key === "open_set" &&
                    card.data?.open_set?.reference_count != null && (
                      <div>
                        <dt>Reference vectors</dt>
                        <dd>{card.data.open_set.reference_count}</dd>
                      </div>
                    )}
                </dl>
              </details>
            ))}
          </div>
        </>
      )}
      <details className="frozen-evaluation">
        <summary>Frozen evaluation</summary>
        {card.loading && <p>Reading the frozen model card…</p>}
        {card.error && (
          <p role="alert">
            {card.error}
            <button className="text-link" onClick={card.reload}>
              Retry model card
            </button>
          </p>
        )}
        {card.data && (
          <>
            <p>
              Artifact-reported evaluation. These are not metrics for the active
              survey.
            </p>
            <dl>
              {Object.entries(
                card.data.metrics.winner?.heldout_test_overall ?? {},
              ).map(([name, value]) => (
                <div key={name}>
                  <dt>{name.replace(/_/g, " ")}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <details>
              <summary>Complete frozen metrics</summary>
              <pre>{JSON.stringify(card.data.metrics, null, 2)}</pre>
            </details>
          </>
        )}
      </details>
      <section className="lab-limitations">
        <p className="eyebrow">INTERPRETATION LIMITS</p>
        <p>
          Evidence strength and anomaly distance are not probabilities. Natural
          Clutter cannot suppress Contacts.
        </p>
        {card.data && (
          <p>
            SHIPWRECK: {card.data.shipwreck_status}. UNKNOWN is not a fourth
            supervised class.
          </p>
        )}
        <p>Reviews are append-only. Online learning is disabled.</p>
      </section>
    </main>
  );
}
