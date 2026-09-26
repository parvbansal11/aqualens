import { useState } from "react";
import { Repeat2 } from "lucide-react";
import { useWorkspace } from "../lib/store";
import { configured } from "../lib/runtime/api";
import { useRemote } from "../lib/runtime/useRemote";
import type { ChangeReadiness } from "../lib/runtime/wire";
import { SectionHeading, Empty } from "../components/ui";
export default function Change() {
  const { survey, recent } = useWorkspace();
  const [baseline, setBaseline] = useState("");
  const validBaseline =
    baseline !== survey?.id && recent.some((s) => s.id === baseline)
      ? baseline
      : "";
  const state = useRemote<ChangeReadiness>(
    configured && survey?.source === "RUNTIME"
      ? `/runtime/surveys/${encodeURIComponent(survey.id)}/change${validBaseline ? `?baseline_survey_id=${encodeURIComponent(validBaseline)}` : ""}`
      : null,
  );
  return (
    <main id="main-content" className="workspace-main change-page">
      <SectionHeading
        eyebrow="REPEAT SURVEY / SCIENTIFIC GATES"
        title="Change analysis"
      />
      <div className="comparison-selection">
        <div>
          <span className="eyebrow">CURRENT SURVEY</span>
          <h2>{survey?.name}</h2>
        </div>
        <Repeat2 size={22} />
        <label className="field-label">
          Baseline survey
          <select
            value={validBaseline}
            onChange={(e) => setBaseline(e.target.value)}
          >
            <option value="">Select a completed survey</option>
            {recent
              .filter((s) => s.id !== survey?.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      {state.loading && <p role="status">Checking comparison prerequisites…</p>}
      {state.error && (
        <p className="error-message" role="alert">
          {state.error}
          <button className="text-link" onClick={state.reload}>
            Retry
          </button>
        </p>
      )}
      {state.data ? (
        <section className="change-gate">
          <span className="gate-symbol">
            <Repeat2 size={29} strokeWidth={1} />
          </span>
          <p className="eyebrow">{state.data.status.replace(/_/g, " ")}</p>
          <h2>
            {state.data.supported
              ? "Comparison prerequisites are satisfied."
              : "This pair cannot support removal claims."}
          </h2>
          <div className="gate-facts">
            <div>
              <span>Spatial reference</span>
              <strong className="mono">
                {state.data.new_survey.spatial_reference_level ??
                  "Not supplied"}
              </strong>
            </div>
            <div>
              <span>Verified coverage</span>
              <strong>
                {state.data.new_survey.coverage_polygon
                  ? "Supplied"
                  : "Not available"}
              </strong>
            </div>
            <div>
              <span>Baseline</span>
              <strong>
                {state.data.baseline_survey.survey_id
                  ? "Selected"
                  : "Not selected"}
              </strong>
            </div>
          </div>
          <p>
            Aqualens will not infer removal from detector absence alone.
          </p>
          {state.data.blockers.length > 0 && (
            <details>
              <summary>Inspect comparison gates</summary>
              {state.data.blockers.map((b, i) => (
                <div className="gate-detail" key={i}>
                  <strong>{b.gate.replace(/_/g, " ")}</strong>
                  <p>{b.reason}</p>
                </div>
              ))}
            </details>
          )}
          <details>
            <summary>Change-state definitions</summary>
            <dl>
              {state.data.semantics.map((s) => (
                <div key={s.state}>
                  <dt>{s.state}</dt>
                  <dd>{s.meaning}</dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      ) : (
        !state.loading &&
        !state.error && (
          <Empty title="Choose runtime surveys to compare.">
            <p>Illustrative surveys do not support change claims.</p>
          </Empty>
        )
      )}
    </main>
  );
}
