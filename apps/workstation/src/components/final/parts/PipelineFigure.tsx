import { COPY } from "../runtime/strings";

/** §5.1 — the ship → sweep → anomaly → marker → report figure. Dots share the
 * accent at rising opacity, joined by a 1px connector. Not an illustration. */
export function PipelineFigure() {
  return (
    <div className="sd-pipeline">
      {COPY.pipeline.map(([title, detail], index) => (
        <div className="sd-pipeline-row" key={title}>
          <div className="sd-pipeline-rail">
            {index < COPY.pipeline.length - 1 ? <span /> : null}
            <i style={{ opacity: 0.25 + index * 0.19 }} />
          </div>
          <div>
            <b>{title}</b>
            <span className="sd-pipeline-note">{detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
