import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

export type Screen = "start" | "home" | "roles" | "mission" | "review" | "contacts" | "map" | "report" | "system";
export interface Route {
  screen: Screen;
  contactId?: string;
}

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
};

let cachedPath = "";
let cachedRoute: Route = { screen: "start" };
function snapshot(): Route {
  if (location.pathname === cachedPath) return cachedRoute;
  cachedPath = location.pathname;
  const parts = location.pathname.split("/").filter(Boolean).slice(1);
  // /workspace is the survey entry; the Mission overview lives at /workspace/overview.
  const screen = parts[0] === "overview" ? "home" : ((parts[0] ?? "start") as Screen);
  cachedRoute = { screen: ["roles", "home", "mission", "review", "contacts", "map", "report", "system"].includes(screen) ? screen : "start", contactId: parts[1] };
  return cachedRoute;
}

export const useRoute = () => useSyncExternalStore(subscribe, snapshot);

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Run a DOM-changing update inside a view transition when the browser supports it. */
export function withTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || reduced()) return update();
  doc.startViewTransition(() => flushSync(update));
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  // Entry parameters (?demo=1, ?role=) are read once at load; they never follow navigation.
  const url = path;
  withTransition(() => {
    if (opts.replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    listeners.forEach((fn) => fn());
  });
}

export const hrefFor = (screen: Screen, contactId?: string) =>
  screen === "start" ? "/workspace" : screen === "home" ? "/workspace/overview" : `/workspace/${screen}${contactId ? `/${contactId}` : ""}`;
