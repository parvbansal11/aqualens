import { useMemo } from "react";
import { contactName, isReviewed, useStore } from "../state/store";
import { analystLabel } from "../api/labels";
import type { Contact } from "../api/types";
import type { Imagery } from "../api/imagery";
import { ContactThumb, Empty, Icon, machineLabel, StatusMark } from "../components/ui";
import { hrefFor, navigate } from "../router";
import { SonarViewer } from "./SonarViewer";
import { Inspector } from "./Inspector";

export function Review() {
  const { state, dispatch, selected, queue, imagery } = useStore();
  const select = (id: string) => dispatch({ type: "select", id });

  if (!state.mission) {
    return (
      <Empty title="No mission open" action={<button className="btn btn--primary" onClick={() => navigate(hrefFor("home"))}>Open a mission</button>}>
        Review starts from a mission. Open one to see its Contacts.
      </Empty>
    );
  }
  if (!selected) {
    return (
      <Empty title="Nothing to review yet" action={<button className="btn" onClick={() => navigate(hrefFor("mission"))}>Open Mission</button>}>
        No Contact has been proposed in this mission. Upload sonar from the Mission view.
      </Empty>
    );
  }

  const awaiting = queue.filter((c) => !isReviewed(c));
  // Arrived from the Map: offer the way back to the same camera and selection.
  let fromMap = false;
  try {
    fromMap = !!sessionStorage.getItem("aqualens.map.return");
  } catch {
    /* no memory */
  }
  const reviewed = queue.filter(isReviewed);
  const img = imagery(selected);
  const onFrame = img ? state.contacts.filter((c) => imagery(c)?.frameId === img.frameId) : [];

  return (
    <div className={`review ${state.panels.queue ? "" : "review--no-queue"} ${state.panels.inspector ? "" : "review--no-insp"}`}>
      {state.panels.queue && (
        <nav className="queue" aria-label="Review queue">
          <header className="queue__head">
            <p className="queue__title">Review queue</p>
            <button className="icon-btn icon-btn--sm" onClick={() => dispatch({ type: "panel", key: "queue" })} aria-label="Hide queue ([)" title="Hide queue ([)">
              <Icon name="chevronLeft" size={14} />
            </button>
          </header>
          <QueueGroup title="Awaiting review" items={awaiting} onSelect={select} />
          <QueueGroup title="Reviewed" items={reviewed} onSelect={select} />
        </nav>
      )}

      <section className="stage" aria-label="Sonar">
        {fromMap && (
          <button className="stage__back" onClick={() => navigate(hrefFor("map"))}>
            <Icon name="chevronLeft" size={14} /> Back to Map
          </button>
        )}
        {!state.panels.queue && (
          <button className="stage__reveal stage__reveal--left" onClick={() => dispatch({ type: "panel", key: "queue" })} aria-label="Show queue ([)">
            <Icon name="chevronRight" size={14} />
          </button>
        )}
        {!state.panels.inspector && (
          <button className="stage__reveal stage__reveal--right" onClick={() => dispatch({ type: "panel", key: "inspector" })} aria-label="Show evidence (])">
            <Icon name="chevronLeft" size={14} />
          </button>
        )}
        {img ? (
          <SonarViewer imagery={img} contacts={onFrame} onSelect={select} />
        ) : (
          <div className="viewer viewer--empty">
            <Empty title="No imagery for this Contact">The service holds no raster for it. Its evidence and verdict are on the right.</Empty>
          </div>
        )}
        <Filmstrip current={img?.frameId ?? null} onSelect={select} />
      </section>

      {state.panels.inspector && <Inspector contact={selected} />}
    </div>
  );
}

function QueueGroup({ title, items, onSelect }: { title: string; items: Contact[]; onSelect: (id: string) => void }) {
  const { selected, imagery, state } = useStore();
  if (!items.length) return null;
  return (
    <div className="queue__group">
      <p className="queue__label">
        {title} <span>{items.length}</span>
      </p>
      <ul>
        {items.map((c) => {
          const on = c.contact_id === selected?.contact_id;
          return (
            <li key={c.contact_id}>
              <button className={`qrow ${on ? "is-selected" : ""}`} onClick={() => onSelect(c.contact_id)} aria-current={on ? "true" : undefined} aria-busy={state.pending === c.contact_id}>
                <span className="qrow__thumb">
                  <ContactThumb imagery={imagery(c)} />
                </span>
                <span className="qrow__text">
                  <span className="qrow__id">{contactName(c)}</span>
                  <span className="qrow__sub">{isReviewed(c) && c.analyst.classification !== "UNRESOLVED" ? analystLabel(c.analyst.classification) : machineLabel(c)}</span>
                </span>
                <StatusMark status={c.analyst.status} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One thumbnail per raster in use, in queue order. Illustrative frames say so. */
function Filmstrip({ current, onSelect }: { current: string | null; onSelect: (id: string) => void }) {
  const { queue, imagery } = useStore();
  const frames = useMemo(() => {
    const seen = new Map<string, { img: Imagery; contacts: Contact[] }>();
    for (const c of queue) {
      const img = imagery(c);
      if (!img) continue;
      const entry = seen.get(img.frameId) ?? { img, contacts: [] };
      entry.contacts.push(c);
      seen.set(img.frameId, entry);
    }
    return [...seen.values()];
  }, [queue, imagery]);
  if (frames.length < 2) return null;
  return (
    <div className="film" aria-label="Frames in this mission">
      <div className="film__survey">
        <p className="film__name">
          Frames <span>{frames.some((f) => f.img.illustrative) ? "illustrative imagery" : "source rasters"}</span>
        </p>
        <div className="film__frames">
          {frames.map(({ img, contacts }) => (
            <button
              key={img.frameId}
              className={`film__frame ${img.frameId === current ? "is-current" : ""}`}
              onClick={() => onSelect((contacts.find((c) => !isReviewed(c)) ?? contacts[0]).contact_id)}
              aria-label={contacts.map(contactName).join(", ")}
              aria-current={img.frameId === current ? "true" : undefined}
            >
              <img src={img.src} alt="" />
              <span className="film__ticks" aria-hidden="true">
                {contacts.map((c) => {
                  const b = imagery(c)!.box;
                  return <i key={c.contact_id} className={isReviewed(c) ? "done" : ""} style={{ left: `${((b.x + b.w / 2) / img.width) * 100}%`, top: `${((b.y + b.h / 2) / img.height) * 100}%` }} />;
                })}
              </span>
              <span className="film__label">{contacts.map(contactName).join(" · ")}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
