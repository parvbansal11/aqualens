import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import "./styles/workspace.css";
import { ACTION_LABEL, analystHint, analystLabel, DEPLOYMENT_LABEL, displayName, PRIORITY_LABEL, shortTime, STATUS_LABEL } from "./api/labels";
import { API_BASE } from "./api/config";
import type { Analyst, ReviewEvent } from "./api/types";
import { hrefFor, navigate, useRoute, withTransition, type Screen } from "./router";
import { contactName, StoreProvider, useStore, type ThemePref } from "./state/store";
import { Palette, type PaletteItem } from "./components/Palette";
import { DemoTag, Empty, Icon, Kbd, machineLabel, Skeleton, StateGlyph } from "./components/ui";
import { useEscape } from "./components/hooks";
import { RoleEntry } from "./screens/RoleEntry";
import { ROLES } from "./roles";
import { Start } from "./screens/Start";
import { HomeMark } from "./components/HomeMark";
import { Home } from "./screens/Home";
import { MissionScreen } from "./screens/Mission";
import { Review } from "./screens/Review";
import { Contacts } from "./screens/Contacts";
// MapLibre is large; it loads only when the Map is opened.
const MapScreen = lazy(() => import("./screens/Map").then((m) => ({ default: m.MapScreen })));
import { Report } from "./screens/Report";
import { System } from "./screens/System";

const LABEL: Record<Screen, string> = { start: "Start", home: "Overview", roles: "Working view", mission: "Mission", review: "Review", contacts: "Contacts", map: "Map", report: "Report", system: "System" };

/** "Match task": sonar work in dark, documents and records in light. */
const TASK_THEME: Record<Screen, "dark" | "light"> = { start: "light", home: "light", roles: "light", mission: "light", review: "dark", contacts: "light", map: "dark", report: "light", system: "light" };

export function Workspace() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const route = useRoute();
  const store = useStore();
  const { state, dispatch } = store;
  const live = state.source === "live";
  // Real mode begins with survey data: /workspace, or any screen while no Mission is open.
  const starting = live && (route.screen === "start" || (state.phase === "no-mission" && route.screen !== "system"));
  const entering = starting || route.screen === "start" || !state.role || route.screen === "roles";
  const system = useSystemScheme();
  const theme = state.themePref === "auto" ? (entering ? system : TASK_THEME[route.screen]) : state.themePref;

  useEffect(() => {
    document.documentElement.dataset.wsTheme = theme;
    document.documentElement.style.colorScheme = theme;
    document.title = `${starting ? "Start with survey data" : entering ? "Choose a working view" : LABEL[route.screen]} · Aqualens`;
  }, [theme, route.screen, entering, starting]);

  // Leaving for the landing page hands the document back untouched.
  useEffect(
    () => () => {
      delete document.documentElement.dataset.wsTheme;
      document.documentElement.style.colorScheme = "";
    },
    [],
  );

  // Entry parameters are consumed once. Demo mode skips the upload entry: its Mission is preloaded,
  // so it opens the role choice, or the chosen role's starting place.
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    const params = new URLSearchParams(location.search);
    if (params.has("demo") || params.has("role")) history.replaceState(null, "", location.pathname);
    // The source was fixed from this mount's URL, so demo here means ?demo=1 on this entry.
    if (state.source === "demo" && route.screen === "start") navigate(state.role ? hrefFor(state.role.home) : hrefFor("roles"), { replace: true });
  }, [state.role, route.screen]);

  // Whichever side changed wins: a new URL (link, back, forward) selects its Contact; a new
  // selection (queue, Next, keyboard) rewrites the URL without adding a history entry.
  const selectedId = store.selected?.contact_id ?? null;
  const lastRoute = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (route.screen !== "review") {
      lastRoute.current = undefined;
      return;
    }
    if (state.phase !== "ready") return;
    const routeChanged = route.contactId !== lastRoute.current;
    lastRoute.current = route.contactId;
    if (routeChanged && route.contactId && route.contactId !== selectedId && state.contacts.some((c) => c.contact_id === route.contactId)) {
      dispatch({ type: "select", id: route.contactId });
    } else if (selectedId && route.contactId !== selectedId) {
      lastRoute.current = selectedId;
      history.replaceState(null, "", hrefFor("review", selectedId));
    }
  }, [route.screen, route.contactId, selectedId, state.phase, state.contacts, dispatch]);

  useGlobalKeys(route.screen, entering);

  if (entering) {
    return (
      <div className="ws ws--entry" data-theme={theme}>
        {starting ? <Start /> : <RoleEntry />}
        <Toast />
      </div>
    );
  }

  return (
    <div className="ws" data-theme={theme}>
      <Toolbar screen={route.screen} theme={theme} />
      <main className={`ws__main ws__main--${route.screen}`} id="ws-main">
        <Body screen={route.screen} />
      </main>
      <Modals />
      <Toast />
    </div>
  );
}

/** The entry follows the system appearance live until a task sets its own. */
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");
function useSystemScheme(): "dark" | "light" {
  return useSyncExternalStore(
    (fn) => {
      const q = darkQuery();
      q.addEventListener("change", fn);
      return () => q.removeEventListener("change", fn);
    },
    () => (darkQuery().matches ? "dark" : "light"),
  );
}

function Body({ screen }: { screen: Screen }) {
  const { state, reload } = useStore();
  if (screen === "system") return <System />;
  if (state.phase === "loading") return <Loading screen={screen} />;
  if (state.phase === "offline" || state.phase === "error")
    return (
      <Empty
        title={state.phase === "offline" ? "Backend unavailable" : "Something went wrong"}
        action={
          <button className="btn btn--primary" onClick={() => void reload()}>
            <Icon name="refresh" size={14} /> Retry
          </button>
        }
      >
        {state.problem ?? "Aqualens could not reach the Aqualens processing service."}
      </Empty>
    );
  if (state.phase === "no-mission" && screen !== "home") return <Home />;
  return (
    <>
      {screen === "home" && <Home />}
      {screen === "mission" && <MissionScreen />}
      {screen === "review" && <Review />}
      {screen === "contacts" && <Contacts />}
      {screen === "map" && (
        <Suspense fallback={<Loading screen="map" />}>
          <MapScreen />
        </Suspense>
      )}
      {screen === "report" && <Report />}
    </>
  );
}

function Loading({ screen }: { screen: Screen }) {
  return (
    <div className={`loading loading--${screen}`} aria-busy="true" aria-label="Loading">
      <Skeleton lines={1} wide />
      <Skeleton lines={4} />
    </div>
  );
}

/* ---------------- toolbar ---------------- */

function Toolbar({ screen, theme }: { screen: Screen; theme: "dark" | "light" }) {
  const { state, dispatch, chooseRole } = useStore();
  const [menu, setMenu] = useState<null | "appearance" | "view">(null);
  const close = useCallback(() => setMenu(null), []);
  useEscape(!!menu, close);
  const role = state.role!;
  const setPref = (pref: ThemePref) => {
    withTransition(() => dispatch({ type: "theme", pref }));
    setMenu(null);
  };
  const hasMission = !!state.mission;
  return (
    <header className="bar">
      <div className="bar__lead">
        <HomeMark className="bar__mark" />
        {hasMission && (
          <a
            className="bar__mission"
            href="/workspace/mission"
            onClick={(e) => {
              e.preventDefault();
              navigate(hrefFor("mission"));
            }}
          >
            <span>{displayName(state.mission!.name, "Mission")}</span>
            {state.mission!.demo && <DemoTag />}
          </a>
        )}
      </div>

      {!hasMission && <span className="bar__tabs" aria-hidden="true" />}
      {hasMission && (
        <nav className="bar__tabs" aria-label="Workspace">
          {role.tabs.map((t) => (
            <a
              key={t}
              href={hrefFor(t)}
              aria-current={screen === t ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(hrefFor(t));
              }}
            >
              {LABEL[t]}
            </a>
          ))}
        </nav>
      )}

      <div className="bar__trail">
        <SystemState />
        <button className="bar__search" onClick={() => dispatch({ type: "modal", modal: "palette" })} aria-label="Search and commands">
          <Icon name="search" />
          <span>Search</span>
          <Kbd>⌘K</Kbd>
        </button>
        <div className="menu-anchor">
          <button className="icon-btn" aria-haspopup="menu" aria-expanded={menu === "appearance"} aria-label="Appearance" onClick={() => setMenu((m) => (m === "appearance" ? null : "appearance"))}>
            <Icon name={theme === "dark" ? "moon" : "sun"} />
          </button>
          {menu === "appearance" && (
            <>
              <div className="menu-catch" onClick={close} />
              <div className="menu" role="menu" aria-label="Appearance">
                {(
                  [
                    ["auto", "Match task", "Review and Map dark, records light"],
                    ["dark", "Dark", "Low glare for sonar"],
                    ["light", "Light", "Daylight and documents"],
                  ] as const
                ).map(([pref, label, hint]) => (
                  <button key={pref} role="menuitemradio" aria-checked={state.themePref === pref} onClick={() => setPref(pref)}>
                    <span className="menu__check">{state.themePref === pref && <Icon name="check" size={14} />}</span>
                    <span>
                      {label}
                      <small>{hint}</small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="menu-anchor">
          <button className="viewer-pill" aria-haspopup="menu" aria-expanded={menu === "view"} onClick={() => setMenu((m) => (m === "view" ? null : "view"))}>
            <span className="viewer-pill__role">{role.name}</span>
            <Icon name="chevronDown" size={12} />
          </button>
          {menu === "view" && (
            <>
              <div className="menu-catch" onClick={close} />
              <div className="menu menu--wide" role="menu" aria-label="Working view">
                <p className="menu__label">Working view</p>
                {ROLES.map((r) => (
                  <button
                    key={r.id}
                    role="menuitemradio"
                    aria-checked={r.id === role.id}
                    onClick={() => {
                      close();
                      if (r.id === role.id) return;
                      // A view change only: same Mission, Contacts and review state; nothing reprocessed.
                      chooseRole(r.id);
                      navigate(hrefFor(r.home));
                    }}
                  >
                    <span className="menu__check">{r.id === role.id && <Icon name="check" size={14} />}</span>
                    <span>
                      {r.name}
                      <small>{r.question}</small>
                    </span>
                  </button>
                ))}
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    navigate(hrefFor("roles"));
                  }}
                >
                  <span className="menu__check">
                    <Icon name="swap" size={14} />
                  </span>
                  <span>Change role</span>
                </button>
                <p className="menu__label">Mission</p>
                <MissionChoices onDone={close} />
                <p className="menu__label">System</p>
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    navigate(hrefFor("system"));
                  }}
                  aria-current={screen === "system" ? "page" : undefined}
                >
                  <span className="menu__check">
                    <Icon name="info" size={14} />
                  </span>
                  <span>System details</span>
                </button>
                <p className="menu__note">Roles change emphasis only. There is no sign-in on this deployment.</p>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/** Mission switcher: the demo Mission and real product Missions, never mixed. */
export function MissionChoices({ onDone }: { onDone?: () => void }) {
  const { state, openMission } = useStore();
  const pick = (source: "demo" | "live", id: string | null) => {
    onDone?.();
    openMission(source, id);
  };
  return (
    <>
      <button role="menuitemradio" aria-checked={state.source === "demo"} onClick={() => pick("demo", null)}>
        <span className="menu__check">{state.source === "demo" && <Icon name="check" size={14} />}</span>
        <span>
          Demo mission
          <small>Deterministic fixture, clearly tagged</small>
        </span>
      </button>
      {state.missions
        .slice()
        .reverse()
        .slice(0, 6)
        .map((m) => (
          <button key={m.mission_id} role="menuitemradio" aria-checked={state.source === "live" && state.missionId === m.mission_id} onClick={() => pick("live", m.mission_id)}>
            <span className="menu__check">{state.source === "live" && state.missionId === m.mission_id && <Icon name="check" size={14} />}</span>
            <span>
              {m.name}
              <small>Survey records · {shortTime(m.created_at)}</small>
            </span>
          </button>
        ))}
    </>
  );
}

/** Quiet service indicator. States come from /readiness, never from a timer. */
function SystemState() {
  const { state, dispatch } = useStore();
  const ready = state.online && state.readiness?.status === "READY";
  const label = !state.online ? "Service unavailable" : !state.readiness ? "Checking service" : ready ? "System ready" : "System not ready";
  return (
    <button className={`sys-state ${ready ? "is-ready" : state.online ? "is-partial" : "is-off"}`} onClick={() => dispatch({ type: "modal", modal: "status" })} aria-label={`${label}. Show service details`}>
      <i aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

/* ---------------- keys ---------------- */

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

function useGlobalKeys(screen: Screen, entering: boolean) {
  const store = useStore();
  const ref = useRef(store);
  ref.current = store;
  useEffect(() => {
    if (entering) return;
    const onKey = (e: KeyboardEvent) => {
      const { state, dispatch, selected, decide, step, next } = ref.current;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        dispatch({ type: "modal", modal: state.modal === "palette" ? null : "palette" });
        return;
      }
      if (state.modal || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      // Return on a focused link or button activates it; it is not the "next Contact" shortcut.
      if (k === "Enter" && (e.target as HTMLElement).closest("a, button")) return;
      const review = screen === "review" && !!selected && !state.pending;
      const handled = ["?", "t", "T"].includes(k) || (review && ["1", "2", "3", "c", "C", "n", "N", "h", "H", "j", "k", "ArrowDown", "ArrowUp", "[", "]", "f", "F", "o", "O", "Enter"].includes(k));
      if (handled) e.preventDefault();
      if (k === "?") dispatch({ type: "modal", modal: "shortcuts" });
      else if (k === "t" || k === "T") withTransition(() => dispatch({ type: "theme", pref: document.documentElement.dataset.wsTheme === "dark" ? "light" : "dark" }));
      else if (review && selected) {
        if (k === "1") void decide(selected.contact_id, "CONFIRMED");
        else if (k === "2") void decide(selected.contact_id, "REJECTED");
        else if (k === "3") void decide(selected.contact_id, "UNRESOLVED");
        else if (k === "c" || k === "C") dispatch({ type: "modal", modal: "classify" });
        else if (k === "n" || k === "N") dispatch({ type: "modal", modal: "note" });
        else if (k === "h" || k === "H") dispatch({ type: "modal", modal: "history" });
        else if (k === "j" || k === "ArrowDown") step(1);
        else if (k === "k" || k === "ArrowUp") step(-1);
        else if (k === "[") dispatch({ type: "panel", key: "queue" });
        else if (k === "]") dispatch({ type: "panel", key: "inspector" });
        else if (k === "f" || k === "F") dispatch({ type: "view", view: { zoom: "fit" } });
        else if (k === "o" || k === "O") dispatch({ type: "overlay", key: "contacts" });
        else if (k === "Enter" && selected.analyst.status !== "UNREVIEWED") next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, entering]);
}

/* ---------------- modals ---------------- */

function Modals() {
  const { state, dispatch, selected, queue, classify, addNote, openMission } = useStore();
  const close = () => dispatch({ type: "modal", modal: null });

  const commands = useMemo<PaletteItem[]>(() => {
    const go = (screen: Screen, label: string, detail: string): PaletteItem => ({ id: `go-${screen}`, group: "Go to", label, detail, run: () => navigate(hrefFor(screen)) });
    const awaiting = queue.find((c) => c.analyst.status === "UNREVIEWED");
    const role = state.role;
    const items: PaletteItem[] = [];
    if (awaiting)
      items.push({
        id: "a-next",
        group: "Suggested",
        label: "Review next Contact",
        detail: `${contactName(awaiting)} · ${machineLabel(awaiting)}`,
        run: () => {
          dispatch({ type: "select", id: awaiting.contact_id });
          navigate(hrefFor("review", awaiting.contact_id));
        },
      });
    if (role) items.push({ id: "a-home", group: "Suggested", label: `Open ${LABEL[role.home]}`, detail: `${role.name} starting place`, run: () => navigate(hrefFor(role.home)) });
    items.push(
      go("home", "Overview", "Mission state and what needs attention"),
      go("mission", "Open Mission", "Surveys, uploads and processing"),
      go("review", "Review", "Sonar, evidence and analyst verdict"),
      go("contacts", "Search Contacts", "Filter every Contact in the mission"),
      go("map", "Map", "Positions where navigation allows"),
      go("report", "Open Report", "Mission report and export"),
      go("system", "System details", "Readiness, model and capability"),
      ...state.contacts.map((c) => ({
        id: `ct-${c.contact_id}`,
        group: "Contacts",
        label: contactName(c),
        detail: `${machineLabel(c)} · ${c.analyst.status === "UNREVIEWED" ? "Awaiting review" : analystLabel(c.analyst.classification)}`,
        keywords: c.contact_id,
        run: () => {
          dispatch({ type: "select", id: c.contact_id });
          navigate(hrefFor("review", c.contact_id));
        },
      })),
      { id: "a-role", group: "Actions", label: "Change role", detail: role?.name, run: () => navigate(hrefFor("roles")) },
      { id: "a-theme", group: "Actions", label: "Toggle appearance", shortcut: "T", run: () => withTransition(() => dispatch({ type: "theme", pref: document.documentElement.dataset.wsTheme === "dark" ? "light" : "dark" })) },
      { id: "a-keys", group: "Actions", label: "Show keyboard shortcuts", shortcut: "?", run: () => setTimeout(() => dispatch({ type: "modal", modal: "shortcuts" })) },
      state.source === "demo"
        ? { id: "a-live", group: "Actions", label: "Open survey records", detail: "Leave the demo mission", run: () => openMission("live", null) }
        : { id: "a-demo", group: "Actions", label: "Open demo mission", detail: "Deterministic fixture", run: () => openMission("demo", null) },
    );
    return items;
  }, [queue, state.role, state.contacts, state.source, dispatch, openMission]);

  const categories = useMemo<PaletteItem[]>(() => {
    if (!selected) return [];
    const current = selected.analyst.classification;
    return (state.provenance?.analyst_classes ?? []).map((code) => ({
      id: code,
      group: "Analyst classification",
      label: analystLabel(code),
      detail: code === current && selected.analyst.status !== "UNREVIEWED" ? "Current" : analystHint(code),
      keywords: code,
      run: () => void classify(selected.contact_id, code).then(() => undefined),
    }));
  }, [selected, state.provenance, classify]);

  if (state.modal === "palette") return <Palette title="Search and commands" placeholder="Search Contacts, screens and commands" items={commands} onClose={close} />;
  if (state.modal === "classify" && selected)
    return (
      <Palette
        title={`Classify ${contactName(selected)}`}
        placeholder={`Classify ${contactName(selected)}`}
        items={categories}
        onClose={close}
        footer={
          <span>
            A human judgement, recorded as a new history entry. The machine assessment
            {selected.machine ? ` (${machineLabel(selected)})` : ""} is not changed.
          </span>
        }
      />
    );
  if (state.modal === "shortcuts") return <Shortcuts onClose={close} />;
  if (state.modal === "history") return <History onClose={close} />;
  if (state.modal === "status") return <StatusSheet onClose={close} />;
  if (state.modal === "note" && selected) return <NoteSheet onClose={close} onSave={(t) => void addNote(selected.contact_id, t)} name={contactName(selected)} />;
  return null;
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["⌘K", "Search and commands"],
    ["1", "Confirm"],
    ["2", "Reject"],
    ["3", "Leave unresolved"],
    ["C", "Classify"],
    ["N", "Add note"],
    ["H", "Review history"],
    ["J / K", "Next or previous Contact"],
    ["Return", "Next Contact awaiting review, once decided"],
    ["F", "Fit sonar to view"],
    ["O", "Show or hide Contacts"],
    ["[  ]", "Queue and evidence panels"],
    ["T", "Toggle appearance"],
  ];
  return (
    <Sheet title="Keyboard shortcuts" onClose={onClose}>
      <p className="sheet__lede">Verdict keys work in Review only, and never while you are typing.</p>
      <dl className="keys">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>
              <Kbd>{k}</Kbd>
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}

/** One sentence per history entry, from its before and after states. */
export function describeEvent(e: ReviewEvent) {
  const diff = (key: keyof Analyst, say: (v: string) => string) => (e.before[key] !== e.after[key] ? say(String(e.after[key])) : null);
  const parts = [
    diff("status", (v) => STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? v),
    diff("classification", (v) => `Classified as ${analystLabel(v)}`),
    diff("priority", (v) => `Priority ${PRIORITY_LABEL[v as keyof typeof PRIORITY_LABEL]?.toLowerCase() ?? v}`),
  ].filter(Boolean);
  if (e.action === "notes") return "Note";
  return parts.length ? parts.join(" · ") : `${ACTION_LABEL[e.action] ?? e.action} recorded, unchanged`;
}

export function HistoryList({ events }: { events: ReviewEvent[] }) {
  if (!events.length) return <p className="muted">No review activity yet.</p>;
  return (
    <ol className="history">
      {[...events].reverse().map((e) => (
        <li key={e.review_id}>
          <time dateTime={e.timestamp}>{shortTime(e.timestamp)}</time>
          <span className="history__by">{e.actor === "DEMO_FIXTURE" ? "Demo fixture" : e.actor}</span>
          <span className="history__what">
            {describeEvent(e)}
            {e.note && <q>{e.note}</q>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function History({ onClose }: { onClose: () => void }) {
  const { selected } = useStore();
  if (!selected) return null;
  return (
    <Sheet title={`${contactName(selected)} history`} onClose={onClose}>
      <p className="sheet__lede">
        Append-only, kept by the Aqualens service. Entries are never edited or removed. Names are declared by the working view, not authenticated.
        {selected.demo && " Every entry here belongs to the demo mission."}
      </p>
      <HistoryList events={selected.history} />
    </Sheet>
  );
}

function StatusSheet({ onClose }: { onClose: () => void }) {
  const { state, refreshSystem } = useStore();
  const r = state.readiness;
  const rows: [string, boolean | undefined, string][] = [
    ["API", state.online ? r?.services.api : false, "Aqualens service"],
    ["Database", r?.services.database, "Missions, Contacts and review history"],
    ["Storage", r?.services.storage, "Uploads and runtime records"],
    ["Detector", r?.services.detector, r ? (r.detector_loaded ? "Frozen detector loaded" : "Frozen detector present; it loads on first inference") : ""],
    ["Reporting", r?.services.reporting, "Structured and HTML reports"],
  ];
  return (
    <Sheet
      title="System status"
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={() => void refreshSystem()}>
            <Icon name="refresh" size={14} /> Check again
          </button>
          <button
            className="btn btn--primary"
            onClick={() => {
              onClose();
              navigate(hrefFor("system"));
            }}
          >
            System details
          </button>
        </>
      }
    >
      {!state.online ? (
        <p className="sheet__lede">Aqualens could not reach the Aqualens processing service at {API_BASE}.</p>
      ) : (
        <p className="sheet__lede">Service checks from the Aqualens API. Readiness is not a measure of scientific validity.</p>
      )}
      <ul className="svc">
        {rows.map(([name, ok, detail]) => (
          <li key={name}>
            <StateGlyph state={ok ? "AVAILABLE" : ok === false ? "UNAVAILABLE" : "NOT_APPLICABLE"} />
            <span className="svc__name">{name}</span>
            <span className="svc__detail">{ok === undefined ? "Unknown" : detail}</span>
          </li>
        ))}
      </ul>
      {state.provenance && (
        <p className="muted small">
          {DEPLOYMENT_LABEL[state.provenance.deployment] ?? state.provenance.deployment} · API {state.provenance.api_version}
        </p>
      )}
    </Sheet>
  );
}

function NoteSheet({ onClose, onSave, name }: { onClose: () => void; onSave: (t: string) => void; name: string }) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);
  const save = () => {
    if (text.trim()) onSave(text.trim());
    onClose();
  };
  return (
    <Sheet
      title={`Note on ${name}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={save} disabled={!text.trim()}>
            Add note
          </button>
        </>
      }
    >
      <textarea
        ref={area}
        className="field"
        rows={4}
        maxLength={4000}
        placeholder="What informed this decision?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          if (e.key === "Escape") onClose();
        }}
      />
      <p className="muted small">⌘ Return adds the note. Notes are appended to the Contact's history.</p>
    </Sheet>
  );
}

export function Sheet({ title, children, onClose, actions }: { title: string; children: React.ReactNode; onClose: () => void; actions?: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <header className="sheet__head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="sheet__body">{children}</div>
        {actions && <footer className="sheet__actions">{actions}</footer>}
      </div>
    </div>
  );
}

function Toast() {
  const { state, dispatch } = useStore();
  const t = state.toast;
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => dispatch({ type: "toast", toast: null }), 4600);
    return () => clearTimeout(id);
  }, [t, dispatch]);
  if (!t) return null;
  return (
    <div className={`toast ${t.tone === "error" ? "toast--error" : ""}`} role="status" key={t.id}>
      <span>{t.text}</span>
      {t.undo && (
        <button
          className="link"
          onClick={() => {
            t.undo!();
            dispatch({ type: "toast", toast: null });
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}

