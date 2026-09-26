import type { ReactNode } from "react";
import type { BadgeTone } from "../runtime/select";

export function Logo({ size = "md" }: { size?: "md" | "sm" }) {
  return (
    <span className="sd-logo" data-size={size}>
      <i />
      <b>Aqualens</b>
    </span>
  );
}

/** §1.3 status badge. Always carries a word. */
export function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  return (
    <span className="sd-badge" data-tone={tone}>
      {label}
    </span>
  );
}

/** §6 canonical unavailable block. Grey, bordered, a bold name and one reason. */
export function Unavailable({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `sd-unavailable ${className}` : "sd-unavailable"}>
      <b>{title}</b>
      <p>{children}</p>
    </div>
  );
}

/** §1.3 segmented control. The only tab pattern in the product. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="sd-seg" role="tablist" aria-label={label}>
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** §6 inline error: what failed, in plain language, plus one retry. */
export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div>
      <p className="sd-error">{message}</p>
      {onRetry ? (
        <button type="button" className="sd-btn-secondary" style={{ marginTop: 12 }} onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function CompleteLine({ children, ready = true }: { children: ReactNode; ready?: boolean }) {
  return (
    <p className="sd-complete" data-ready={ready}>
      <i>{ready ? "✓" : "·"}</i>
      {children}
    </p>
  );
}
