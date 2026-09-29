import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Contact } from "../api/types";
import type { Imagery } from "../api/imagery";
import { contactName, useStore } from "../state/store";
import { Icon, StatusMark } from "../components/ui";
import { useEscape } from "../components/hooks";

interface ViewT {
  s: number;
  x: number;
  y: number;
}

/**
 * The sonar owns the screen. Content layer: the raster and its Contacts.
 * Functional layer: one floating control group, monochrome.
 */
export function SonarViewer({ imagery: frame, contacts, onSelect }: { imagery: Imagery; contacts: Contact[]; onSelect: (id: string) => void }) {
  const { state, dispatch, selected, imagery } = useStore();
  const host = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<ViewT>({ s: 1, x: 0, y: 0 });
  const [animate, setAnimate] = useState(true);
  const [menu, setMenu] = useState(false);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const focusContact = contacts.find((c) => c.contact_id === selected?.contact_id);
  const boxOf = (c: Contact) => imagery(c)?.box ?? frame.box;
  const closeMenu = useCallback(() => setMenu(false), []);
  useEscape(menu, closeMenu);

  const fit = useCallback((): ViewT => {
    const el = host.current;
    if (!el) return { s: 1, x: 0, y: 0 };
    const s = Math.min(el.clientWidth / frame.width, el.clientHeight / frame.height) * 0.94;
    return { s, x: (el.clientWidth - frame.width * s) / 2, y: (el.clientHeight - frame.height * s) / 2 };
  }, [frame]);

  const focusOn = useCallback(
    (c: Contact): ViewT => {
      const el = host.current;
      if (!el) return fit();
      const f = fit();
      const box = boxOf(c);
      // Frame the Contact comfortably: never closer than 3x fit, never so close that context disappears.
      const want = Math.min(el.clientWidth / (box.w * 5.5), el.clientHeight / (box.h * 4.2));
      const s = Math.max(f.s, Math.min(f.s * 3, want));
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      // Centre the Contact, but never pull the raster's edge into view when it could fill the stage.
      const clamp = (v: number, view: number, size: number) => (size <= view ? (view - size) / 2 : Math.min(0, Math.max(view - size, v)));
      return { s, x: clamp(el.clientWidth / 2 - cx * s, el.clientWidth, frame.width * s), y: clamp(el.clientHeight / 2 - cy * s, el.clientHeight, frame.height * s) };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fit, frame],
  );

  // Selecting a Contact brings it to the centre of attention.
  useLayoutEffect(() => {
    setAnimate(true);
    setT(state.view.zoom === "fit" || !focusContact ? fit() : focusOn(focusContact));
  }, [selected?.contact_id, frame.frameId, state.view.zoom, focusContact, fit, focusOn]);

  useEffect(() => {
    const onResize = () => setT(state.view.zoom === "fit" || !focusContact ? fit() : focusOn(focusContact));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [state.view.zoom, focusContact, fit, focusOn]);

  const zoomBy = (k: number) => {
    const el = host.current!;
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    setAnimate(true);
    setT((v) => {
      const s = Math.max(fit().s * 0.8, Math.min(v.s * k, 6));
      return { s, x: cx - ((cx - v.x) * s) / v.s, y: cy - ((cy - v.y) * s) / v.s };
    });
    dispatch({ type: "view", view: { zoom: 1 } });
  };

  const onWheel = (e: React.WheelEvent) => {
    setAnimate(false);
    if (e.ctrlKey || e.metaKey) {
      const rect = host.current!.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      setT((v) => {
        const s = Math.max(fit().s * 0.8, Math.min(v.s * Math.exp(-e.deltaY * 0.01), 6));
        return { s, x: px - ((px - v.x) * s) / v.s, y: py - ((py - v.y) * s) / v.s };
      });
      dispatch({ type: "view", view: { zoom: 1 } });
    } else setT((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };

  const pct = Math.round((t.s / fit().s) * 100);
  const filter = `brightness(${state.view.gain}) contrast(${1 + (state.view.gain - 1) * 0.6})${state.view.palette === "copper" ? " sepia(1) saturate(1.6) hue-rotate(-12deg)" : ""}`;
  const ov = state.view.overlays;

  return (
    <div
      ref={host}
      className="viewer"
      onWheel={onWheel}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button,.viewer__controls,.menu")) return;
        drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        setAnimate(false);
        setT((v) => ({ ...v, x: drag.current!.tx + e.clientX - drag.current!.x, y: drag.current!.ty + e.clientY - drag.current!.y }));
      }}
      onPointerUp={() => (drag.current = null)}
      aria-label={`Sonar${frame.label ? `, ${frame.label}` : ""}${frame.illustrative ? ", illustrative imagery" : ""}`}
    >
      <div className={`viewer__plane ${animate ? "is-animated" : ""}`} style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`, width: frame.width, height: frame.height, ["--k" as string]: String(1 / t.s) }}>
        <img src={frame.src} width={frame.width} height={frame.height} alt="" draggable={false} style={{ filter }} />
        {ov.sides && frame.nadirCol !== null && <div className="viewer__nadir" style={{ left: frame.nadirCol }} />}
        {focusContact && ov.contacts && (
          <div
            className="viewer__dim"
            style={{
              ["--fx" as string]: `${boxOf(focusContact).x + boxOf(focusContact).w / 2}px`,
              ["--fy" as string]: `${boxOf(focusContact).y + boxOf(focusContact).h / 2}px`,
              ["--fr" as string]: `${Math.max(boxOf(focusContact).w, boxOf(focusContact).h) * 1.4}px`,
            }}
          />
        )}
        {ov.contacts &&
          contacts.map((c) => {
            const b = boxOf(c);
            const isSel = c.contact_id === selected?.contact_id;
            const done = c.analyst.status !== "UNREVIEWED";
            return (
              <button
                key={c.contact_id}
                className={`box ${isSel ? "box--selected" : ""} ${done ? "box--reviewed" : ""} ${frame.illustrative ? "box--illustrative" : ""}`}
                style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
                onClick={() => onSelect(c.contact_id)}
                aria-label={`${contactName(c)}, ${done ? "reviewed" : "awaiting review"}${frame.illustrative ? ", illustrative imagery" : ""}`}
                aria-pressed={isSel}
              >
                <i className="box__c box__c--tl" />
                <i className="box__c box__c--tr" />
                <i className="box__c box__c--bl" />
                <i className="box__c box__c--br" />
                <span className="box__tag">{contactName(c)}</span>
              </button>
            );
          })}
      </div>

      {ov.sides && frame.nadirCol !== null && (
        <>
          <span className="viewer__side viewer__side--port">Port</span>
          <span className="viewer__side viewer__side--star">Starboard</span>
        </>
      )}

      <div className="viewer__hud">
        {frame.illustrative && <span className="viewer__illus">Illustrative imagery</span>}
        {frame.label && <span>{frame.label}</span>}
        {frame.axes && (
          <>
            {frame.label && <span className="viewer__hud-sep" />}
            <span>{frame.axes}</span>
          </>
        )}
      </div>
      {frame.credit && <p className="viewer__credit">{frame.credit}</p>}

      {contacts.length === 0 && (
        <div className="viewer__none">
          <p>No Contacts proposed in this Frame.</p>
        </div>
      )}

      <div className="viewer__controls" role="toolbar" aria-label="View">
        <button className="icon-btn" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">
          <Icon name="minus" />
        </button>
        <span className="viewer__zoom" aria-live="polite">
          {pct}%
        </span>
        <button className="icon-btn" onClick={() => zoomBy(1.4)} aria-label="Zoom in">
          <Icon name="plus" />
        </button>
        <span className="viewer__sep" />
        <button
          className="icon-btn"
          onClick={() => {
            dispatch({ type: "view", view: { zoom: "fit" } });
            setAnimate(true);
            setT(fit());
          }}
          aria-label="Fit to view (F)"
          title="Fit to view (F)"
        >
          <Icon name="fit" />
        </button>
        {focusContact && (
          <button
            className="text-btn"
            onClick={() => {
              dispatch({ type: "view", view: { zoom: 1 } });
              setAnimate(true);
              setT(focusOn(focusContact));
            }}
          >
            Focus {contactName(focusContact)}
          </button>
        )}
        <span className="viewer__sep" />
        <div className="menu-anchor">
          <button className="text-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            View <Icon name="chevronDown" size={12} />
          </button>
          {menu && (
            <>
              <div className="menu-catch" onClick={() => setMenu(false)} />
              <div className="menu menu--up" role="menu" aria-label="View options">
                <p className="menu__label">Overlays</p>
                {(
                  [
                    ["contacts", "Contacts", "O"],
                    ["sides", "Sides and nadir", ""],
                  ] as const
                ).map(([key, label, k]) => (
                  <button key={key} role="menuitemcheckbox" aria-checked={ov[key]} onClick={() => dispatch({ type: "overlay", key })}>
                    <span className="menu__check">{ov[key] && <Icon name="check" size={14} />}</span>
                    <span>{label}</span>
                    {k && <kbd className="kbd">{k}</kbd>}
                  </button>
                ))}
                <p className="menu__label">Palette</p>
                {(
                  [
                    ["grey", "Greyscale"],
                    ["copper", "Copper"],
                  ] as const
                ).map(([p, label]) => (
                  <button key={p} role="menuitemradio" aria-checked={state.view.palette === p} onClick={() => dispatch({ type: "view", view: { palette: p } })}>
                    <span className="menu__check">{state.view.palette === p && <Icon name="check" size={14} />}</span>
                    <span>{label}</span>
                  </button>
                ))}
                <p className="menu__label">Gain</p>
                <label className="menu__range">
                  <input type="range" min={0.6} max={1.8} step={0.05} value={state.view.gain} onChange={(e) => dispatch({ type: "view", view: { gain: Number(e.target.value) } })} aria-label="Display gain" />
                  <span>{state.view.gain.toFixed(2)}×</span>
                </label>
                <p className="menu__note">Display only. Evidence is always computed on the original raster.</p>
              </div>
            </>
          )}
        </div>
      </div>

      {focusContact && (
        <div className="viewer__focus-status">
          <StatusMark status={focusContact.analyst.status} />
        </div>
      )}
    </div>
  );
}
