import type { ReactNode } from "react";
import type { Contact, EvidenceStatus, Priority, ReviewStatus } from "../api/types";
import { AVAILABILITY_LABEL, CLASS_LABEL, PRIORITY_LABEL, STATUS_LABEL } from "../api/labels";

/* ---------- icons: one hairline family, 16px grid ---------- */
const PATHS: Record<string, string> = {
  search: "M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5",
  sun: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1",
  moon: "M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z",
  info: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 7v4.5M8 4.6v.1",
  chevronDown: "M4 6l4 4 4-4",
  chevronRight: "M6 4l4 4-4 4",
  chevronLeft: "M10 4 6 8l4 4",
  arrowRight: "M2.5 8h11M9 3.5 13.5 8 9 12.5",
  plus: "M8 3v10M3 8h10",
  minus: "M3 8h10",
  fit: "M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4",
  layers: "M8 2 1.5 5.5 8 9l6.5-3.5L8 2ZM1.5 8.5 8 12l6.5-3.5M1.5 11 8 14.5l6.5-3.5",
  upload: "M8 11V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v3h11v-3",
  folder: "M1.5 4h4l1.5 1.5h7.5v8h-13V4Z",
  history: "M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2 2.5v2.4h2.4M8 5v3.2l2 1.3",
  note: "M3 2.5h10v11H3zM5.5 6h5M5.5 8.5h5M5.5 11h3",
  tag: "M2 2h6l6 6-6 6-6-6V2ZM5 5.2v.1",
  close: "M3.5 3.5l9 9M12.5 3.5l-9 9",
  check: "M3 8.5 6.5 12 13 4.5",
  map: "M1.5 3.5 5.5 2l5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5V3.5ZM5.5 2v10.5M10.5 3.5V14",
  doc: "M3.5 1.5h6l3 3v10h-9v-13ZM9.5 1.5v3h3M5.5 8h5M5.5 10.5h5",
  grid: "M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  keyboard: "M1.5 4h13v8h-13zM4 6.5h.1M6.5 6.5h.1M9 6.5h.1M11.5 6.5h.1M4.5 9.5h7",
  flag: "M3 14.5V2M3 2.5h9l-2 3 2 3H3",
  refresh: "M13.5 8a5.5 5.5 0 1 1-1.7-4M13.5 2v3h-3",
  swap: "M2.5 5h10M9.5 2l3 3-3 3M13.5 11h-10M6.5 8l-3 3 3 3",
  download: "M8 2.5V11M4.5 7.5 8 11l3.5-3.5M2.5 13.5h11",
};
export function Icon({ name, size = 16, label }: { name: keyof typeof PATHS | string; size?: number; label?: string }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={PATHS[name]} stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- machine labels: plain words in the product, codes only where provenance needs them ---------- */
/** Machine output only. A Contact without a supervised class is never given one here. */
export const machineLabel = (c: Contact) => (c.machine ? CLASS_LABEL[c.machine.supervised_class] : "Local anomaly");

/** The operator-facing Contact confidence: the backend's display_confidence, never the raw score. */
export const confidenceText = (c: Contact) =>
  c.machine?.display_confidence != null ? c.machine.display_confidence.toFixed(2) : null;

/* ---------- evidence availability: shape carries meaning, color only supports it ---------- */
export function StateGlyph({ state, size = 10 }: { state: EvidenceStatus; size?: number }) {
  const r = size / 2 - 1;
  const c = size / 2;
  return (
    <svg className={`glyph glyph--${state.toLowerCase()}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {state === "AVAILABLE" && <circle cx={c} cy={c} r={r} />}
      {state === "UNAVAILABLE" && <circle cx={c} cy={c} r={r} fill="none" />}
      {state === "NOT_VALIDATED" && (
        <>
          <circle cx={c} cy={c} r={r} fill="none" />
          <path d={`M${c} ${c - r}A${r} ${r} 0 0 1 ${c} ${c + r}Z`} />
        </>
      )}
      {state === "NOT_APPLICABLE" && <line x1={1.5} x2={size - 1.5} y1={c} y2={c} />}
      {state === "FAILED" && <path d={`M2 2L${size - 2} ${size - 2}M${size - 2} 2L2 ${size - 2}`} />}
    </svg>
  );
}
export function StateChip({ state, children }: { state: EvidenceStatus; children?: ReactNode }) {
  return (
    <span className="state-chip">
      <StateGlyph state={state} /> {children ?? AVAILABILITY_LABEL[state]}
    </span>
  );
}

/* ---------- review status mark ---------- */
export function StatusMark({ status }: { status: ReviewStatus }) {
  const cls = status === "UNREVIEWED" ? "awaiting" : status === "UNRESOLVED" ? "uncertain" : status.toLowerCase();
  return (
    <span className={`status status--${cls}`}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        {status === "UNREVIEWED" && <circle cx="6" cy="6" r="4.5" />}
        {status === "CONFIRMED" && <path d="M2.5 6.3 5 8.7l4.5-5.2" />}
        {status === "REJECTED" && <path d="M3 3l6 6M9 3 3 9" />}
        {status === "UNRESOLVED" && <path d="M4.3 4.4a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1M6 9.3v.1" />}
      </svg>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Band({ priority }: { priority: Priority }) {
  const bars = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNSET: 0 }[priority];
  return (
    <span className={`band band--${priority.toLowerCase()}`}>
      <svg width="13" height="10" viewBox="0 0 13 10" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={i * 3.3} y={8 - i * 2.4} width="2.2" height={2 + i * 2.4} className={i < bars ? "on" : ""} />
        ))}
      </svg>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function DemoTag({ children = "Demo" }: { children?: ReactNode }) {
  return <span className="demo-tag">{children}</span>;
}

/** Empty states: a title, one sentence, and at most one action. */
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <svg className="empty__mark" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
        <path d="M2 30h40" />
        <path d="M22 4v34" className="empty__nadir" />
      </svg>
      <p className="empty__title">{title}</p>
      <p className="empty__text">{children}</p>
      {action}
    </div>
  );
}

/** Restrained placeholder while the Aqualens service answers. */
export function Skeleton({ lines = 3, wide = false }: { lines?: number; wide?: boolean }) {
  return (
    <div className={`skeleton ${wide ? "skeleton--wide" : ""}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <i key={i} style={{ width: `${[88, 64, 76, 52, 70][i % 5]}%` }} />
      ))}
    </div>
  );
}

/** A crop of a raster, for thumbnails. */
export function Crop({ src, box, pad = 1.6, frame, mark = false }: { src: string; box: { x: number; y: number; w: number; h: number }; pad?: number; frame: { width: number; height: number }; mark?: boolean }) {
  const side = Math.max(box.w, box.h) * pad;
  // Keep the window inside the raster where it fits, so edge Contacts never show empty canvas.
  const inside = (c: number, size: number) => (side >= size ? size / 2 : Math.min(size - side / 2, Math.max(side / 2, c)));
  const cx = inside(box.x + box.w / 2, frame.width), cy = inside(box.y + box.h / 2, frame.height);
  return (
    <svg className="crop" viewBox={`${cx - side / 2} ${cy - side / 2} ${side} ${side}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <image href={src} width={frame.width} height={frame.height} />
      {mark && <rect className="crop__mark" x={box.x} y={box.y} width={box.w} height={box.h} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** Thumbnail for a Contact, or a quiet blank when no imagery exists. */
export function ContactThumb({ imagery, pad, mark }: { imagery: { src: string; box: { x: number; y: number; w: number; h: number }; width: number; height: number } | null; pad?: number; mark?: boolean }) {
  return imagery ? <Crop src={imagery.src} frame={imagery} box={imagery.box} pad={pad} mark={mark} /> : <span className="thumb-none" aria-hidden="true" />;
}
