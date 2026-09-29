/**
 * App-level client routing between the landing page and the workspace. Only the path decides the
 * surface; navigating here never touches workspace data, which the workspace keeps in the backend
 * and its own persisted preferences.
 */
const EVENT = "aqualens:navigate";

export function subscribePath(fn: () => void) {
  window.addEventListener("popstate", fn);
  window.addEventListener(EVENT, fn);
  return () => {
    window.removeEventListener("popstate", fn);
    window.removeEventListener(EVENT, fn);
  };
}

export function goTo(path: string) {
  if (location.pathname + location.search === path) return;
  history.pushState(null, "", path);
  window.scrollTo(0, 0);
  window.dispatchEvent(new Event(EVENT));
}

/** Click handler for surface links: modified clicks keep their browser meaning (new tab, etc.). */
export function linkTo(path: string) {
  return (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    goTo(path);
  };
}
