import { useEffect, useRef, useState } from "react";
import { ROLES, type Role } from "../roles";
import { hrefFor, navigate } from "../router";
import { useStore } from "../state/store";
import { displayName } from "../api/labels";
import { HomeMark } from "../components/HomeMark";

/** Thin line marks, one per working view. Drawn, not illustrated. */
function Glyph({ kind }: { kind: Role["glyph"] }) {
  return (
    <svg className="role__glyph" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
      {kind === "track" && <path d="M6 9h24v6H6v6h24v6H6" />}
      {kind === "ping" && (
        <>
          <circle cx="18" cy="18" r="2" className="fill" />
          <path d="M11.5 11.5a9.2 9.2 0 0 0 0 13M24.5 11.5a9.2 9.2 0 0 1 0 13M7 7a15.5 15.5 0 0 0 0 22M29 7a15.5 15.5 0 0 1 0 22" />
        </>
      )}
      {kind === "ledger" && <path d="M9 6h13l5 5v19H9zM13 15h10M13 20h10M13 25h6" />}
      {kind === "signal" && (
        <>
          <circle cx="18" cy="18" r="11" />
          <circle cx="18" cy="18" r="3.2" className="fill" />
        </>
      )}
    </svg>
  );
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function RoleEntry() {
  const { state, chooseRole } = useStore();
  const [chosen, setChosen] = useState<Role | null>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const previous = state.role;


  const enter = (role: Role) => {
    if (chosen) return;
    setChosen(role);
    const go = () => {
      chooseRole(role.id);
      navigate(hrefFor(role.home), { replace: true });
    };
    if (reduced()) go();
    else setTimeout(go, 420);
  };

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = (i + (e.key === "ArrowDown" ? 1 : -1) + ROLES.length) % ROLES.length;
      rows.current[n]?.focus();
    }
  };

  // Nothing is pre-selected. The first arrow press brings focus in (last used role first); 1 to 4 choose directly.
  useEffect(() => {
    const onDigit = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= ROLES.length && !e.metaKey && !e.ctrlKey) enter(ROLES[n - 1]);
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !rows.current.includes(document.activeElement as HTMLButtonElement)) {
        e.preventDefault();
        const start = previous ? ROLES.findIndex((r) => r.id === previous.id) : e.key === "ArrowDown" ? 0 : ROLES.length - 1;
        rows.current[start]?.focus();
      }
    };
    window.addEventListener("keydown", onDigit);
    return () => window.removeEventListener("keydown", onDigit);
  });

  const missionName = state.mission ? displayName(state.mission.name, "Mission") : null;

  return (
    <div className={`roles ${chosen ? "roles--leaving" : ""}`}>
      <div className="roles__inner">
        <HomeMark className="roles__mark" />
        {missionName && (
          <p className="roles__mission">
            <span>{missionName}</span>
            {state.mission?.demo ? <span className="demo-tag">Demo</span> : <span className="roles__mission-sub">{state.contacts.length} Contact{state.contacts.length === 1 ? "" : "s"}</span>}
          </p>
        )}
        <h1 className="roles__title">How are you working with this mission?</h1>
        <p className="roles__lede">Choose a working view. Every view opens the same mission, Contacts and evidence.</p>

        <ol className="roles__list" aria-label="Working views">
          {ROLES.map((role, i) => (
            <li key={role.id}>
              <button
                ref={(el) => {
                  rows.current[i] = el;
                }}
                className={`role ${chosen?.id === role.id ? "is-chosen" : ""} ${previous?.id === role.id ? "is-previous" : ""}`}
                onClick={() => enter(role)}
                onKeyDown={(e) => onKey(e, i)}
                aria-describedby={`role-q-${role.id}`}
              >
                <Glyph kind={role.glyph} />
                <span className="role__text">
                  <span className="role__name">{role.name}</span>
                  <span className="role__q" id={`role-q-${role.id}`}>
                    {role.question}
                  </span>
                </span>
                <span className="role__key" aria-hidden="true">
                  {previous?.id === role.id ? "Last used" : i + 1}
                </span>
              </button>
            </li>
          ))}
        </ol>

        <p className="roles__foot">
          {state.source === "live" ? (
            <a className="link" href="/workspace" onClick={(e) => { e.preventDefault(); navigate(hrefFor("start")); }}>
              Back to Survey Intake
            </a>
          ) : (
            <span />
          )}
          <span>A working view, not a sign-in. You can change it at any time.</span>
        </p>
      </div>
    </div>
  );
}
