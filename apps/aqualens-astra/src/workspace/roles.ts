/**
 * Workspace roles. Names and questions are the existing Aqualens taxonomy
 * (backend /roles/{role}: field-officer, sonar-analyst, mission-supervisor, decision-viewer;
 * questions from apps/workstation runtime strings).
 *
 * A role is a working view: it changes where you start, which destinations lead, and the primary
 * action. It is not an identity and grants nothing. The backend has no access control, and every
 * role sees the same Mission, Contacts, evidence and report.
 */
import type { Screen } from "./router";

export type RoleId = "field-officer" | "sonar-analyst" | "mission-supervisor" | "decision-viewer";

export interface Role {
  id: RoleId;
  name: string;
  question: string;
  /** Short alias accepted in ?role= links. */
  alias: string;
  home: Screen;
  tabs: Screen[];
  glyph: "track" | "ping" | "ledger" | "signal";
}

export const ROLES: Role[] = [
  { id: "field-officer", name: "Field Officer", alias: "field", question: "What should I inspect next?", home: "mission", tabs: ["mission", "review", "map", "contacts", "report"], glyph: "track" },
  { id: "sonar-analyst", name: "Sonar Analyst", alias: "analyst", question: "What exactly did the system see, and why?", home: "review", tabs: ["review", "contacts", "map", "mission", "report"], glyph: "ping" },
  { id: "mission-supervisor", name: "Mission Supervisor", alias: "supervisor", question: "What happened in this survey and what requires action?", home: "report", tabs: ["report", "contacts", "review", "mission", "map"], glyph: "ledger" },
  { id: "decision-viewer", name: "Decision Viewer", alias: "decision", question: "What requires attention?", home: "home", tabs: ["home", "report", "contacts", "map", "mission"], glyph: "signal" },
];

export const roleById = (id: string | null | undefined) => ROLES.find((r) => r.id === id || r.alias === id) ?? null;

const KEY = "aqualens.workspace.role";

export function readRole(): Role | null {
  const fromUrl = roleById(new URLSearchParams(location.search).get("role"));
  if (fromUrl) {
    saveRole(fromUrl.id);
    return fromUrl;
  }
  try {
    return roleById(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveRole(id: RoleId | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* preference only */
  }
}
