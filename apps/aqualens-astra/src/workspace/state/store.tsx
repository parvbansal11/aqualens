/**
 * Workspace state. Backend data (Mission, Surveys, Contacts, capabilities, provenance, readiness)
 * is loaded through api/client.ts only; every review action is written to the backend first and the
 * screen shows what the backend then returns. Nothing here is a local copy of the truth.
 *
 * Data source: "demo" is the backend's deterministic, isolated demo Mission; "live" is a real
 * product Mission. Both use the same API shapes.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { api, ApiFailure } from "../api/client";
import { imageryFor, type Imagery } from "../api/imagery";
import { PRIORITY_RANK } from "../api/labels";
import type { AnalystClass, Capabilities, Contact, Job, Mission, Priority, Provenance, Readiness, ReviewDecision, ReviewEvent, Survey, Upload } from "../api/types";
import { readRole, saveRole, type Role, type RoleId, roleById } from "../roles";

export type ThemePref = "auto" | "dark" | "light";
export type Overlay = "contacts" | "sides";
export type Source = "demo" | "live";
export type Phase = "loading" | "ready" | "offline" | "no-mission" | "error";

interface Data {
  phase: Phase;
  problem: string | null;
  source: Source;
  missionId: string | null;
  mission: Mission | null;
  surveys: Survey[];
  uploads: Upload[];
  jobs: Job[];
  contacts: Contact[];
  missions: Mission[];
  capabilities: Capabilities | null;
  provenance: Provenance | null;
  readiness: Readiness | null;
  online: boolean;
}

interface State extends Data {
  role: Role | null;
  selectedId: string | null;
  pending: string | null;
  themePref: ThemePref;
  view: { zoom: number | "fit"; palette: "grey" | "copper"; gain: number; overlays: Record<Overlay, boolean> };
  panels: { queue: boolean; inspector: boolean };
  modal: null | "palette" | "classify" | "shortcuts" | "history" | "note" | "status";
  toast: null | { id: number; text: string; undo?: () => void; tone?: "error" };
}

type Action =
  | { type: "data"; data: Partial<Data> }
  | { type: "contact"; contact: Contact }
  | { type: "select"; id: string | null }
  | { type: "pending"; id: string | null }
  | { type: "role"; role: Role | null }
  | { type: "theme"; pref: ThemePref }
  | { type: "view"; view: Partial<State["view"]> }
  | { type: "overlay"; key: Overlay }
  | { type: "panel"; key: keyof State["panels"] }
  | { type: "modal"; modal: State["modal"] }
  | { type: "toast"; toast: State["toast"] };

const PREFS = "aqualens.workspace.v2";
/** The real Mission last open in this browser. Demo never writes here, so the two stay apart. */
const LIVE_MISSION = "aqualens.workspace.liveMission";

/**
 * ?demo=1 on arrival opens the deterministic demo Mission; every other entry is real mode. Read each
 * time the workspace mounts, never cached per page load: a demo visit must not follow the person
 * back through the landing page into their next real session.
 */
const isDemoEntry = () => new URLSearchParams(location.search).get("demo") === "1";

function readPrefs(): Pick<State, "themePref" | "view" | "panels"> & { source: Source; missionId: string | null } {
  const demoEntry = isDemoEntry();
  let saved: Partial<State> = {};
  let liveMission: string | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(PREFS) ?? "{}");
    liveMission = localStorage.getItem(LIVE_MISSION);
  } catch {
    /* storage unavailable: defaults */
  }
  return {
    themePref: saved.themePref ?? "auto",
    view: { zoom: 1, palette: "grey", gain: 1, overlays: { contacts: true, sides: true }, ...(saved.view ?? {}) },
    panels: { queue: true, inspector: true, ...(saved.panels ?? {}) },
    // Real mode never falls back to demo data: without a remembered real Mission it starts empty.
    source: demoEntry ? "demo" : "live",
    missionId: demoEntry ? null : liveMission,
  };
}

function init(): State {
  const prefs = readPrefs();
  return {
    phase: "loading",
    problem: null,
    source: prefs.source,
    missionId: prefs.missionId,
    mission: null,
    surveys: [],
    uploads: [],
    jobs: [],
    contacts: [],
    missions: [],
    capabilities: null,
    provenance: null,
    readiness: null,
    online: true,
    role: readRole(),
    selectedId: null,
    pending: null,
    themePref: prefs.themePref,
    view: prefs.view,
    panels: prefs.panels,
    modal: null,
    toast: null,
  };
}

let toastSeq = 0;
function reducer(state: State, a: Action): State {
  switch (a.type) {
    case "data":
      return { ...state, ...a.data };
    case "contact":
      return { ...state, contacts: state.contacts.map((c) => (c.contact_id === a.contact.contact_id ? a.contact : c)) };
    case "select":
      return { ...state, selectedId: a.id };
    case "pending":
      return { ...state, pending: a.id };
    case "role":
      return { ...state, role: a.role };
    case "theme":
      return { ...state, themePref: a.pref };
    case "view":
      return { ...state, view: { ...state.view, ...a.view } };
    case "overlay":
      return { ...state, view: { ...state.view, overlays: { ...state.view.overlays, [a.key]: !state.view.overlays[a.key] } } };
    case "panel":
      return { ...state, panels: { ...state.panels, [a.key]: !state.panels[a.key] } };
    case "modal":
      return { ...state, modal: a.modal };
    case "toast":
      return { ...state, toast: a.toast ? { ...a.toast, id: ++toastSeq } : null };
  }
}

/* ---------- derived helpers ---------- */

export const isReviewed = (c: Contact) => c.analyst.status !== "UNREVIEWED";

/** Short, stable display name. Demo fixture IDs read as letters; real IDs keep their unique tail. */
export function contactName(c: Pick<Contact, "contact_id" | "demo">) {
  const demo = /^demo_contact_([a-z])$/.exec(c.contact_id);
  if (demo) return `Contact ${demo[1].toUpperCase()}`;
  return `C-${c.contact_id.slice(-6).toUpperCase()}`;
}

/** Contacts to review first: awaiting review, then analyst priority, then creation order. */
export function queueOrder(contacts: Contact[]) {
  return [...contacts].sort(
    (a, b) =>
      Number(isReviewed(a)) - Number(isReviewed(b)) ||
      PRIORITY_RANK[a.analyst.priority] - PRIORITY_RANK[b.analyst.priority] ||
      a.created_at.localeCompare(b.created_at) ||
      a.contact_id.localeCompare(b.contact_id),
  );
}

interface Store {
  state: State;
  dispatch: React.Dispatch<Action>;
  selected: Contact | null;
  queue: Contact[];
  imagery: (c: Contact) => Imagery | null;
  actor: string;
  reload: () => Promise<void>;
  refreshSystem: () => Promise<void>;
  openMission: (source: Source, missionId?: string | null) => void;
  chooseRole: (id: RoleId | null) => void;
  decide: (id: string, status: ReviewDecision) => Promise<void>;
  classify: (id: string, classification: AnalystClass) => Promise<void>;
  setPriority: (id: string, priority: Priority) => Promise<void>;
  addNote: (id: string, text: string) => Promise<void>;
  step: (dir: 1 | -1) => void;
  next: () => void;
  notify: (text: string, tone?: "error") => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const loadSeq = useRef(0);
  /** The source and Mission the current data belongs to, so resolving an ID does not load twice. */
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    try {
      const { themePref, view, panels, source, missionId, phase } = state;
      localStorage.setItem(PREFS, JSON.stringify({ themePref, view, panels }));
      if (source === "live" && phase !== "loading") {
        if (missionId) localStorage.setItem(LIVE_MISSION, missionId);
        else localStorage.removeItem(LIVE_MISSION);
      }
    } catch {
      /* preference only */
    }
  }, [state]);

  const notify = useCallback((text: string, tone?: "error") => dispatch({ type: "toast", toast: { id: 0, text, tone } }), []);

  const refreshSystem = useCallback(async () => {
    try {
      const [readiness, capabilities, provenance] = await Promise.all([api.readiness(), api.capabilities(), api.provenance()]);
      dispatch({ type: "data", data: { readiness, capabilities, provenance, online: true } });
    } catch (e) {
      if (e instanceof ApiFailure && e.offline) dispatch({ type: "data", data: { online: false } });
    }
  }, []);

  const load = useCallback(async (source: Source, wanted: string | null) => {
    const seq = ++loadSeq.current;
    dispatch({ type: "data", data: { phase: "loading", problem: null } });
    try {
      const [readiness, capabilities, provenance, all] = await Promise.all([api.readiness(), api.capabilities(), api.provenance(), api.missions()]);
      const missions = all.filter((m) => !m.legacy && !m.demo);
      let missionId = wanted;
      if (source === "demo") missionId = (await api.demoMissions())[0]?.mission_id ?? null;
      // Only the Mission the person chose; never an arbitrary latest one.
      else if (missionId && !missions.some((m) => m.mission_id === missionId)) missionId = null;
      if (seq !== loadSeq.current) return;
      loadedKey.current = `${source}:${missionId}`;
      const base = { readiness, capabilities, provenance, missions, source, missionId, online: true };
      if (!missionId) {
        dispatch({ type: "data", data: { ...base, phase: "no-mission", mission: null, surveys: [], uploads: [], jobs: [], contacts: [] } });
        return;
      }
      const [mission, surveys, uploads, jobs, page] = await Promise.all([
        api.mission(missionId),
        api.surveys(missionId),
        api.uploads(missionId),
        api.jobs(missionId),
        api.contacts(missionId),
      ]);
      if (seq !== loadSeq.current) return;
      dispatch({ type: "data", data: { ...base, phase: "ready", mission, surveys, uploads, jobs, contacts: page.items } });
    } catch (e) {
      if (seq !== loadSeq.current) return;
      const failure = e instanceof ApiFailure ? e : new ApiFailure("The workspace could not load.", "UNKNOWN", null);
      dispatch({ type: "data", data: { phase: failure.offline ? "offline" : "error", problem: failure.message, online: !failure.offline } });
    }
  }, []);

  const reload = useCallback(() => {
    loadedKey.current = null;
    return load(state.source, state.missionId);
  }, [load, state.source, state.missionId]);
  useEffect(() => {
    if (loadedKey.current === `${state.source}:${state.missionId}`) return;
    void load(state.source, state.missionId);
    // Load once per chosen source and Mission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.source, state.missionId]);

  // Readiness is polled quietly so the status indicator reflects the service, never a guess.
  useEffect(() => {
    const id = setInterval(refreshSystem, 30000);
    return () => clearInterval(id);
  }, [refreshSystem]);

  const openMission = useCallback((source: Source, missionId: string | null = null) => {
    loadedKey.current = null;
    dispatch({ type: "select", id: null });
    // Switch atomically: the previous Mission's records must never be shown under the new Mission's id.
    dispatch({ type: "data", data: { source, missionId, phase: "loading", mission: null, surveys: [], uploads: [], jobs: [], contacts: [] } });
  }, []);

  const chooseRole = useCallback((id: RoleId | null) => {
    saveRole(id);
    dispatch({ type: "role", role: roleById(id) });
  }, []);

  const queue = useMemo(() => queueOrder(state.contacts), [state.contacts]);
  const selected = state.contacts.find((c) => c.contact_id === state.selectedId) ?? queue[0] ?? null;
  // The selection is pinned, never re-derived: re-sorting the queue after a verdict must not move
  // the analyst to a different Contact mid-decision.
  useEffect(() => {
    if (state.phase === "ready" && selected && selected.contact_id !== state.selectedId) dispatch({ type: "select", id: selected.contact_id });
  }, [state.phase, selected, state.selectedId]);
  const actor = state.role?.name ?? "Workspace user";

  const imageryCache = useMemo(() => new Map<string, Imagery | null>(), [state.surveys]);
  const imagery = useCallback(
    (c: Contact) => {
      if (!imageryCache.has(c.contact_id)) imageryCache.set(c.contact_id, imageryFor(c, state.surveys));
      return imageryCache.get(c.contact_id) ?? null;
    },
    [imageryCache, state.surveys],
  );

  /** Every analyst action: write, then show what the backend recorded. No optimistic state. */
  const mutate = useCallback(
    async (id: string, write: () => Promise<ReviewEvent>, done: (event: ReviewEvent) => string, undo?: (event: ReviewEvent) => (() => Promise<unknown>) | null) => {
      dispatch({ type: "pending", id });
      try {
        const event = await write();
        const contact = await api.contact(id);
        dispatch({ type: "contact", contact });
        const revert = undo?.(event);
        dispatch({
          type: "toast",
          toast: {
            id: 0,
            text: done(event),
            undo: revert
              ? () =>
                  void revert()
                    .then(() => api.contact(id))
                    .then((c) => {
                      dispatch({ type: "contact", contact: c });
                      notify("Reverted. Both entries stay in history.");
                    })
                    .catch((e) => notify(e instanceof ApiFailure ? e.message : "Could not revert.", "error"))
              : undefined,
          },
        });
      } catch (e) {
        notify(e instanceof ApiFailure ? e.message : "The change was not saved.", "error");
        if (e instanceof ApiFailure && e.offline) dispatch({ type: "data", data: { online: false } });
      } finally {
        dispatch({ type: "pending", id: null });
      }
    },
    [notify],
  );

  const decide = useCallback(
    (id: string, status: ReviewDecision) =>
      mutate(
        id,
        () => api.review(id, actor, status),
        () => ({ CONFIRMED: "Confirmed", REJECTED: "Rejected", UNRESOLVED: "Left unresolved" })[status],
        (e) => (e.before.status !== "UNREVIEWED" && e.before.status !== status ? () => api.review(id, actor, e.before.status as ReviewDecision, "Reverted") : null),
      ),
    [mutate, actor],
  );
  const classify = useCallback(
    (id: string, classification: AnalystClass) =>
      mutate(
        id,
        () => api.classify(id, actor, classification),
        () => "Analyst classification recorded",
        (e) => (e.before.classification !== classification ? () => api.classify(id, actor, e.before.classification, "Reverted") : null),
      ),
    [mutate, actor],
  );
  const setPriority = useCallback(
    (id: string, priority: Priority) =>
      mutate(
        id,
        () => api.priority(id, actor, priority),
        () => "Analyst priority recorded",
        (e) => (e.before.priority !== priority ? () => api.priority(id, actor, e.before.priority, "Reverted") : null),
      ),
    [mutate, actor],
  );
  const addNote = useCallback((id: string, text: string) => mutate(id, () => api.note(id, actor, text), () => "Note added"), [mutate, actor]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!queue.length) return;
      const i = queue.findIndex((c) => c.contact_id === selected?.contact_id);
      dispatch({ type: "select", id: queue[(i + dir + queue.length) % queue.length].contact_id });
    },
    [queue, selected],
  );
  /** The next Contact still awaiting review; otherwise the next in the queue. */
  const next = useCallback(() => {
    const awaiting = queue.find((c) => c.contact_id !== selected?.contact_id && !isReviewed(c));
    if (awaiting) dispatch({ type: "select", id: awaiting.contact_id });
    else step(1);
  }, [queue, selected, step]);

  const value = useMemo<Store>(
    () => ({ state, dispatch, selected, queue, imagery, actor, reload, refreshSystem, openMission, chooseRole, decide, classify, setPriority, addNote, step, next, notify }),
    [state, selected, queue, imagery, actor, reload, refreshSystem, openMission, chooseRole, decide, classify, setPriority, addNote, step, next, notify],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}
