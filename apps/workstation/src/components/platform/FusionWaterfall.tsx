import type { Detection } from "@/lib/types";
import { fixed, humanise } from "@/lib/view/format";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { Unavailable } from "./Unavailable";

/**
 * Per term contributions to the fused confidence, in log odds.
 *
 * If the backend returns a null confidence with a reason, the whole section
 * refuses to draw bars rather than plotting a zero baseline.
 */
export function FusionWaterfall({ detection }: { detection: Detection }) {
  const { fusion, provenance } = detection;

  if (fusion.final_confidence === null || fusion.intercept === null) {
    return (
      <section className="inspector-section">
        <h3>Confidence contributions, log odds</h3>
        <Unavailable reason={fusion.reason ?? "FUSION_ARTIFACT_ABSENT"} label="Not available" />
      </section>
    );
  }

  const terms: [string, number][] = [
    ["Intercept", fusion.intercept],
    ...Object.entries(fusion.contributions),
  ];
  const max = Math.max(1, ...terms.map(([, value]) => Math.abs(value)));

  return (
    <section className="inspector-section">
      <h3>Confidence contributions, log odds</h3>
      <div className="waterfall">
        {terms.map(([label, value]) => (
          <div className="contribution" key={label}>
            <span title={humanise(label)}>{humanise(label)}</span>
            <div className="contribution-track">
              <i
                className={value >= 0 ? "positive" : "negative"}
                style={{ width: `${((Math.abs(value) / max) * 50).toFixed(2)}%` }}
              />
            </div>
            <code>{fixed(value, 2)}</code>
          </div>
        ))}
      </div>
      <p style={{ margin: 0, color: "var(--text-3)", fontSize: 12 }}>
        Calibration <code>{fusion.calibration_id ?? "none"}</code>, model{" "}
        <code>{fusion.fusion_model_id ?? "none"}</code>
      </p>
      <ProvenanceBadge value={provenance.fusion} />
    </section>
  );
}
