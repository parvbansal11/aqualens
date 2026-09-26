"use client";

import { useState } from "react";
import { LEVEL_LADDER, PIPELINE_STAGES } from "@/demo/public-content";

export function StageExplorer() {
  const [index, setIndex] = useState(3);
  const stage = PIPELINE_STAGES[index];

  return (
    <>
      <div className="stage-chips" role="tablist" aria-label="Pipeline stages">
        {PIPELINE_STAGES.map((item, i) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="stage-chip"
            aria-selected={i === index}
            aria-controls="stage-detail"
            onClick={() => setIndex(i)}
          >
            {i === index && <i aria-hidden="true" />}
            {item.id}
          </button>
        ))}
      </div>

      <div className="stage-panel">
        <div className="stage-detail" id="stage-detail" role="tabpanel">
          <p className="kicker-mono">
            STAGE {stage.num} OF {PIPELINE_STAGES.length}
          </p>
          <h2>{stage.title}</h2>
          <p>{stage.body}</p>
          <dl className="stage-contract">
            <dt>Receives</dt>
            <dd>{stage.receives}</dd>
            <dt>Emits</dt>
            <dd>{stage.emits}</dd>
            <dt>Refuses</dt>
            <dd className="refuses">{stage.refuses}</dd>
          </dl>
        </div>

        <aside className="ladder">
          <h3>SPATIAL REFERENCE LEVEL</h3>
          <p>
            Capability is declared, never assumed. Each tile carries the level its
            metadata actually supports.
          </p>
          {LEVEL_LADDER.map((rung) => (
            <div className="ladder-row" key={rung.id}>
              <code>{rung.id}</code>
              <span>
                <b>{rung.name}</b>
                <small>{rung.body}</small>
              </span>
            </div>
          ))}
        </aside>
      </div>
    </>
  );
}
