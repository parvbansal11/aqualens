/* Entry module mounts once; route components are lazy modules. */
/* eslint-disable react-refresh/only-export-components */
import React, { lazy, Suspense, useEffect } from "react";
import ReactDOM, { type Root } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  useLocation,
  Link,
  Navigate,
} from "react-router-dom";
import { StoreProvider } from "./lib/store";
import "@fontsource-variable/manrope";
import "@fontsource-variable/dm-sans";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/product.css";
import "./styles/chrome.css";
const Landing = lazy(() => import("./pages/Landing"));
const Roles = lazy(() => import("./pages/Roles"));
const Shell = lazy(() => import("./components/Shell"));
const Home = lazy(() => import("./pages/Home"));
const Upload = lazy(() => import("./pages/Upload"));
const Processing = lazy(() => import("./pages/Processing"));
const Results = lazy(() => import("./pages/Results"));
const Contact = lazy(() => import("./pages/Contact"));
const MapPage = lazy(() => import("./pages/MapPage"));
const IntakeShell = lazy(() => import("./components/IntakeShell"));
const Review = lazy(() => import("./pages/Review"));
const Report = lazy(() => import("./pages/Report"));
const Memory = lazy(() => import("./pages/Memory"));
const ModelLab = lazy(() => import("./pages/ModelLab"));
const Change = lazy(() => import("./pages/Change"));
function ProcessingAlias() {
  return <Navigate to={`/intake/processing${useLocation().search}`} replace />;
}
function RouteReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    const section = pathname.split("/").filter(Boolean);
    const titles: Record<string, string> = {
      intake: "Survey Intake",
      processing: "Survey Processing",
      roles: "Choose Your Station",
      workspace: "Workspace",
      upload: "Survey Intake",
      results: "Contacts",
      contact: "Contact",
      map: "Survey Map",
      review: "Review",
      report: "Survey Report",
      memory: "Review Memory",
      "model-lab": "Model Lab",
      change: "Change Analysis",
    };
    const title = titles[section[1] ?? section[0]];
    document.title = title ? `${title} · Aqualens` : "Aqualens";
    const timer = setTimeout(() => {
      document.querySelector("main")?.setAttribute("tabindex", "-1");
      document.querySelector("main")?.focus({ preventScroll: true });
    }, 100);
    return () => clearTimeout(timer);
  }, [pathname]);
  return null;
}
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="error-boundary">
        <h1>The workspace could not be displayed.</h1>
        <p>Your original survey files have not changed.</p>
        <a className="button" href="/workspace">
          Reopen workspace
        </a>
      </main>
    ) : (
      this.props.children
    );
  }
}
function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <StoreProvider>
          <a className="skip-link" href="#main-content">
            Skip to main content
          </a>
          <RouteReset />
          <Suspense
            fallback={
              <main className="app-loading" aria-label="Loading workspace">
                <span className="loading-echo" />
              </main>
            }
          >
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/roles" element={<Roles />} />
              <Route path="/intake" element={<IntakeShell />}>
                <Route index element={<Upload intake />} />
                <Route path="processing" element={<Processing />} />
              </Route>
              <Route
                path="/workspace/processing"
                element={<ProcessingAlias />}
              />
              <Route path="/workspace" element={<Shell />}>
                <Route index element={<Home />} />
                <Route path="upload" element={<Upload />} />
                <Route path="results" element={<Results />} />
                <Route path="contact/:contactId" element={<Contact />} />
                <Route path="map" element={<MapPage />} />
                <Route path="review" element={<Review />} />
                <Route path="review/:contactId" element={<Review />} />
                <Route path="report" element={<Report />} />
                <Route path="memory" element={<Memory />} />
                <Route path="model-lab" element={<ModelLab />} />
                <Route path="change" element={<Change />} />
              </Route>
              <Route
                path="*"
                element={
                  <main className="error-boundary">
                    <h1>This route is outside the survey.</h1>
                    <Link className="button" to="/workspace">
                      Return to Workspace
                    </Link>
                  </main>
                }
              />
            </Routes>
          </Suspense>
        </StoreProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
const root =
  (import.meta.hot?.data.root as Root | undefined) ??
  ReactDOM.createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
