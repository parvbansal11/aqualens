import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  X,
  Sun,
  Moon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useWorkspace } from "../lib/store";
import { reviewLabel } from "../lib/runtime/selectors";
export function Logo() {
  return (
    <Link className="wordmark" to="/" aria-label="Aqualens home">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path d="M6 15q14-16 28 0M11 23q9-11 18 0M16 31q4-6 8 0" />
      </svg>
      <span>
        Aqua<span className="wordmark-light">lens</span>
      </span>
    </Link>
  );
}
export function ThemeButton() {
  const { theme, toggleTheme } = useWorkspace();
  return (
    <button
      className="icon-button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`review-status status-${value.toLowerCase()}`}>
      {value === "CONFIRMED" ? (
        <CircleCheck size={14} />
      ) : (
        <CircleDashed size={14} />
      )}{" "}
      {reviewLabel(value)}
    </span>
  );
}
export function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      {children}
    </div>
  );
}
export function IllustrativeNote({ compact = false }: { compact?: boolean }) {
  return (
    <div className="illustrative-note">
      <span className="illustrative-dot" />
      {compact ? "Illustrative survey" : "Illustrative evidence"}
      {!compact && (
        <span className="illustrative-explanation">No model inference</span>
      )}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <svg className="empty-echo" viewBox="0 0 200 120" aria-hidden="true">
        <path d="M15 110a85 85 0 0 1 170 0M40 110a60 60 0 0 1 120 0M65 110a35 35 0 0 1 70 0" />
      </svg>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function ArrowLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link className="text-link" to={to}>
      {children}
      <ArrowUpRight size={17} />
    </Link>
  );
}
export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-inner">
        <header>
          <div>
            <p className="eyebrow">CONTACT RECORD</p>
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            autoFocus
            onClick={onClose}
            aria-label="Close panel"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
