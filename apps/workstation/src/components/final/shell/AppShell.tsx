"use client";

import { useState, type ReactNode } from "react";
import { Logo } from "../parts/Primitives";
import { BUTTONS, ROLES } from "../runtime/strings";
import { surveyTimestamp } from "../runtime/select";
import type {
  ConnectionState,
  RoleId,
  RuntimeSurvey,
  RuntimeSurveySummary,
  Screen,
} from "../runtime/types";

type NavItem = readonly [string, Screen];

/**
 * §4 — role-filtered navigation. Route-guarded, not merely hidden.
 *
 * `primary` is the judge-facing, one-glance destination set (~4 items); a
 * screen reachable only via `secondary` still holds full route access
 * (`roleHolds` checks both) but is tucked behind the sidebar's "More" toggle
 * so it never competes visually with the primary operational path.
 */
export const NAV: Record<RoleId, { primary: readonly NavItem[]; secondary: readonly NavItem[] }> = {
  field: {
    primary: [
      ["Mission", "results"],
      ["Next inspections", "review"],
      ["Map", "map"],
      ["Report", "report"],
    ],
    secondary: [],
  },
  analyst: {
    primary: [
      ["Survey", "results"],
      ["Workspace", "workspace"],
      ["Review", "review"],
      ["Report", "report"],
    ],
    secondary: [
      ["Map", "map"],
      ["Review memory", "memory"],
      ["Change", "change"],
      ["Model Lab", "lab"],
    ],
  },
  supervisor: {
    primary: [
      ["Overview", "mission"],
      ["Findings", "results"],
      ["Priority", "review"],
      ["Reports", "report"],
    ],
    secondary: [
      ["Coverage", "map"],
      ["Change", "change"],
      ["Review memory", "memory"],
    ],
  },
  decision: {
    primary: [
      ["Overview", "decision"],
      ["Important findings", "results"],
      ["Reports", "report"],
    ],
    secondary: [],
  },
};

export const HOME: Record<RoleId, Screen> = {
  field: "results",
  analyst: "results",
  supervisor: "mission",
  decision: "decision",
};

export function roleName(role: RoleId) {
  return ROLES.find((item) => item.id === role)?.name ?? "";
}

/** A role reaching a route it does not hold gets a plain page, never a partial one. */
export function roleHolds(role: RoleId, screen: Screen) {
  if (screen === "upload" || screen === "processing" || screen === "workspace") {
    /* Upload and processing are reachable from every workspace. The sonar
     * workspace is the analyst-deepest screen and is analyst only. */
    return screen === "workspace" ? role === "analyst" : true;
  }
  if (screen === "lab") return role === "analyst";
  return NAV[role].primary.some(([, target]) => target === screen) || NAV[role].secondary.some(([, target]) => target === screen);
}

const CONNECTION_LABEL: Record<ConnectionState["status"], string> = {
  CHECKING: "Checking service",
  ONLINE: "Service connected",
  DEGRADED: "Service degraded",
  OFFLINE: "Service unreachable",
};

/**
 * The service state indicator. It always says one of four things via an
 * `aria-live` status region, so a judge never has to guess whether a blank
 * screen means "no data" or "no backend" — but it only takes up real visual
 * space when there is something wrong to say. ONLINE/CHECKING stay a
 * single compact line; DEGRADED/OFFLINE expand with the detail a person
 * would need to act on it.
 */
function ConnectionStrip({ connection }: { connection: ConnectionState }) {
  const health = connection.health;
  const expanded = connection.status === "DEGRADED" || connection.status === "OFFLINE";
  const detail =
    connection.message ??
    (health
      ? `${health.device} · detector ${health.runtime_available ? "verified" : "unavailable"}${health.model_sha256 ? ` · ${health.model_sha256.slice(0, 8)}` : ""}`
      : "Contacting the analysis service…");
  return (
    <div
      className="sd-connection"
      data-status={connection.status}
      data-compact={expanded ? undefined : "true"}
      role="status"
      aria-live="polite"
      title={connection.checkedAt ? `Last checked ${new Date(connection.checkedAt).toLocaleTimeString()}` : undefined}
    >
      <i aria-hidden="true" />
      <b>{CONNECTION_LABEL[connection.status]}</b>
      {expanded ? <span>{detail}</span> : null}
    </div>
  );
}

/** Reconnect list: reopen a survey this deployment still holds. */
function RecentSurveys({
  recent,
  activeId,
  onOpenRecent,
}: {
  recent: RuntimeSurveySummary[];
  activeId: string | null;
  onOpenRecent: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (recent.length === 0) return null;
  return (
    <div className="sd-recent">
      <button
        type="button"
        className="sd-recent-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{`Recent surveys (${recent.length})`}</span>
        <em aria-hidden="true">{open ? "▴" : "▾"}</em>
      </button>
      {open ? (
        <ul className="sd-recent-list">
          {recent.map((item) => (
            <li key={item.survey_id}>
              <button
                type="button"
                aria-current={item.survey_id === activeId ? "true" : undefined}
                onClick={() => onOpenRecent(item.survey_id)}
              >
                <b>{item.name}</b>
                <span className="sd-mono">
                  {`${item.contact_count} contact${item.contact_count === 1 ? "" : "s"} · ${item.finding_count} observation${item.finding_count === 1 ? "" : "s"}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AppShell({
  role,
  screen,
  survey,
  connection,
  recent,
  onOpenRecent,
  onNavigate,
  onLanding,
  onUpload,
  onEntry,
  children,
}: {
  role: RoleId;
  screen: Screen;
  survey: RuntimeSurvey | null;
  connection: ConnectionState;
  recent: RuntimeSurveySummary[];
  onOpenRecent: (id: string) => void;
  onNavigate: (screen: Screen) => void;
  onLanding: () => void;
  onUpload: () => void;
  onEntry: () => void;
  children: ReactNode;
}) {
  const contactCount = survey?.contacts?.length ?? 0;
  return (
    <div className="sd-root sd-app">
      <a className="sd-skip" href="#sd-main">
        Skip to main content
      </a>
      <aside className="sd-sidebar">
        <button type="button" className="sd-sidebar-brand" onClick={onLanding}>
          <Logo size="sm" />
        </button>

        <div className="sd-active-survey">
          <small className="sd-eyebrow">Active survey</small>
          <b>{survey ? survey.name : "No survey loaded"}</b>
          <span className="sd-mono">{survey ? survey.survey_id : "Upload a survey to begin"}</span>
        </div>

        <nav className="sd-sidebar-nav" aria-label={`${roleName(role)} navigation`}>
          {NAV[role].primary.map(([label, target]) => (
            <button
              key={label}
              type="button"
              aria-current={screen === target ? "page" : undefined}
              onClick={() => onNavigate(target)}
            >
              {label}
            </button>
          ))}
          {NAV[role].secondary.length > 0 || recent.length > 0 ? (
            <details className="sd-nav-more">
              <summary>More</summary>
              {NAV[role].secondary.map(([label, target]) => (
                <button
                  key={label}
                  type="button"
                  aria-current={screen === target ? "page" : undefined}
                  onClick={() => onNavigate(target)}
                >
                  {label}
                </button>
              ))}
              <RecentSurveys recent={recent} activeId={survey?.survey_id ?? null} onOpenRecent={onOpenRecent} />
            </details>
          ) : null}
        </nav>

        <div className="sd-sidebar-foot">
          <ConnectionStrip connection={connection} />
          <button type="button" className="sd-btn-secondary" onClick={onUpload}>
            {BUTTONS.newSurvey}
          </button>
          <div className="sd-role-switch">
            <small className="sd-eyebrow">Workspace</small>
            <button type="button" onClick={onEntry}>
              <span>{roleName(role)}</span>
              <em>Change</em>
            </button>
          </div>
        </div>
      </aside>

      <main className="sd-main" id="sd-main">
        {/* §6 live survey context strip. Its 45px height is frozen: the sonar
         * workspace sizes itself as calc(100vh - 45px). */}
        <div className="sd-context">
          <b>{survey ? survey.name : "No survey loaded"}</b>
          <span>
            {survey
              ? `${contactCount} contact${contactCount === 1 ? "" : "s"} from ${survey.findings.length} raw observation${survey.findings.length === 1 ? "" : "s"} across ${survey.frames.length} source ${survey.frames.length === 1 ? "frame" : "frames"}.`
              : "Upload a supported sonar raster to begin."}
          </span>
          <span className="sd-context-clock sd-mono">{surveyTimestamp(survey)}</span>
        </div>
        {children}
      </main>
    </div>
  );
}
