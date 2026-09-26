import type { Detection } from "@/lib/types";
import { fixed, pixels } from "@/lib/view/format";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { Unavailable } from "./Unavailable";

function Meter({ label, ratio, value }: { label: string; ratio: number | null; value: string | null }) {
  return (
    <div className="channel-meter">
      <span>{label}</span>
      <b>
        {ratio !== null && <i style={{ width: `${Math.min(100, Math.max(0, ratio * 100)).toFixed(1)}%` }} />}
      </b>
      <code>{value ?? "unavailable"}</code>
    </div>
  );
}

/**
 * The three evidence channels.
 *
 * Each channel is either applicable, in which case its measured values render,
 * or not applicable, in which case its reason renders. There is no third path.
 */
export function EvidencePanel({ detection }: { detection: Detection }) {
  const { persistence, shadow, context } = detection.evidence;

  return (
    <section className="inspector-section">
      <h3>Evidence channels</h3>

      <div className="evidence-card">
        <div className="evidence-title">
          <strong>Persistence</strong>
          <span>{persistence.mode ?? "MODE UNAVAILABLE"}</span>
        </div>
        {persistence.applicable ? (
          <>
            {persistence.n_opportunities !== null && (
              <div className="obs-track" aria-hidden="true">
                {Array.from({ length: persistence.n_opportunities }, (_, i) => (
                  <i key={i} className={i < (persistence.n_obs ?? 0) ? "on" : undefined} />
                ))}
              </div>
            )}
            <b>
              {persistence.n_obs ?? "?"} of {persistence.n_opportunities ?? "?"} observations
            </b>
            <small>
              Wilson score {fixed(persistence.score, 2) ?? "unavailable"}, scatter{" "}
              {persistence.scatter_m !== null
                ? `${fixed(persistence.scatter_m, 1)} m`
                : (pixels(persistence.scatter_px, 1) ?? "unavailable")}
            </small>
          </>
        ) : (
          <Unavailable reason={persistence.reason} />
        )}
      </div>

      <div className="evidence-card">
        <div className="evidence-title">
          <strong>Acoustic shadow</strong>
          <span>range ordering</span>
        </div>
        {shadow.applicable ? (
          <>
            <Meter
              label="Contrast z"
              ratio={shadow.contrast_z === null ? null : shadow.contrast_z / 4}
              value={fixed(shadow.contrast_z, 1)}
            />
            <Meter label="Continuity" ratio={shadow.continuity} value={fixed(shadow.continuity, 2)} />
            <small>
              Ordering {shadow.ordering_ok === null ? "unavailable" : shadow.ordering_ok ? "holds" : "failed"},
              shadow length {pixels(shadow.shadow_len_px, 0) ?? "unavailable"}
              {shadow.implied_height_m !== null && `, implied height ${fixed(shadow.implied_height_m, 1)} m`}
            </small>
            {shadow.height_assumptions.length > 0 && (
              <small>Assumptions: {shadow.height_assumptions.join(", ")}</small>
            )}
          </>
        ) : (
          <Unavailable reason={shadow.reason} />
        )}
      </div>

      <div className="evidence-card">
        <div className="evidence-title">
          <strong>Range context</strong>
          <span>local background</span>
        </div>
        {context.applicable ? (
          <small>
            Background z {fixed(context.background_z, 1) ?? "unavailable"}, clutter density{" "}
            {fixed(context.clutter_density, 2) ?? "unavailable"}
          </small>
        ) : (
          <Unavailable reason={context.reason} />
        )}
      </div>

      {detection.evidence.completeness.length > 0 && (
        <small style={{ display: "block", color: "var(--text-3)", fontSize: 12 }}>
          Completeness notes: {detection.evidence.completeness.join(", ")}
        </small>
      )}

      <ProvenanceBadge value={detection.provenance.evidence} />
    </section>
  );
}
