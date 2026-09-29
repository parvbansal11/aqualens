import { lazy, Suspense, useSyncExternalStore } from "react";
import { subscribePath } from "./lib/nav";

// Each surface loads its own stylesheet, so landing and workspace class names never meet.
const Landing = lazy(() => import("./Landing"));
const Workspace = lazy(() => import("./workspace/Workspace").then((m) => ({ default: m.Workspace })));

const onWorkspace = () => location.pathname.startsWith("/workspace");

export function App() {
  const workspace = useSyncExternalStore(subscribePath, onWorkspace);
  return <Suspense fallback={null}>{workspace ? <Workspace /> : <Landing />}</Suspense>;
}
