import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import {
  ChevronDown,
  ArrowUpRight,
  Map,
  Upload,
  History,
  FlaskConical,
  Repeat2,
} from "lucide-react";
import { useWorkspace } from "../lib/store";
import { capabilities, roles } from "../lib/runtime/selectors";
import { Logo, ThemeButton, IllustrativeNote } from "./ui";
export default function Shell() {
  const { role, survey, surveyLoading, connection, openSurvey, recent } =
    useWorkspace();
  const [more, setMore] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const location = useLocation();
  useEffect(() => {
    if (!more) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRoot.current?.contains(event.target as Node)) setMore(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [more]);
  if (surveyLoading)
    return (
      <main className="app-loading" aria-label="Loading survey">
        <span className="loading-echo" />
      </main>
    );
  if (!survey) return <Navigate to="/intake" replace />;
  if (!role) return <Navigate to="/roles" replace />;
  const caps = capabilities(survey),
    isMap = location.pathname.endsWith("/map");
  const section = location.pathname.split("/")[2];
  if (
    (section === "review" && role === "decision") ||
    (section === "model-lab" && role !== "analyst") ||
    (["memory", "change"].includes(section) &&
      !["analyst", "supervisor"].includes(role))
  )
    return <Navigate to="/workspace" replace />;
  return (
    <div className={`workspace-shell ${isMap ? "map-shell" : ""}`}>
      <header className="workspace-header">
        <Logo />
        <nav className="primary-nav" aria-label="Workspace navigation">
          <NavLink to="/workspace" end>
            Survey
          </NavLink>
          <NavLink to="/workspace/results">Analyse</NavLink>
          {role !== "decision" && (
            <NavLink to="/workspace/review">Review</NavLink>
          )}
          <NavLink to="/workspace/report">Report</NavLink>
          <div
            ref={menuRoot}
            className="more-wrap"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setMore(false);
                menuButton.current?.focus();
              }
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setMore(false);
            }}
          >
            <button
              ref={menuButton}
              className={isMap ? "active" : ""}
              aria-expanded={more}
              aria-controls={more ? "workspace-more" : undefined}
              onClick={() => setMore((v) => !v)}
            >
              More
              <ChevronDown size={13} />
            </button>
            {more && (
              <>
                <div className="nav-dropdown" id="workspace-more">
                  {caps.navigation && role !== "decision" && (
                    <Link to="/workspace/map" onClick={() => setMore(false)}>
                      <Map size={16} />
                      Survey map
                      <ArrowUpRight size={14} />
                    </Link>
                  )}
                  {["analyst", "supervisor"].includes(role) && (
                    <Link to="/workspace/memory" onClick={() => setMore(false)}>
                      <History size={16} />
                      Review Memory
                    </Link>
                  )}
                  {role === "analyst" && (
                    <Link
                      to="/workspace/model-lab"
                      onClick={() => setMore(false)}
                    >
                      <FlaskConical size={16} />
                      Model Lab
                    </Link>
                  )}
                  {["analyst", "supervisor"].includes(role) &&
                    survey.source === "RUNTIME" &&
                    caps.navigation && (
                      <Link
                        to="/workspace/change"
                        onClick={() => setMore(false)}
                      >
                        <Repeat2 size={16} />
                        Change analysis
                      </Link>
                    )}
                  <Link to="/intake" onClick={() => setMore(false)}>
                    <Upload size={16} />
                    Open another survey
                  </Link>
                  <Link to="/roles" onClick={() => setMore(false)}>
                    Change station
                    <ArrowUpRight size={14} />
                  </Link>
                </div>
              </>
            )}
          </div>
        </nav>
        <div className="header-tools">
          <Link className="role-switch" to="/roles">
            {roles.find((r) => r.id === role)?.name}
            <ChevronDown size={12} />
          </Link>
          <ThemeButton />
        </div>
      </header>
      <div className="mission-strip">
        <div className="mission-picker">
          <span className="mission-label">SURVEY</span>
          <select
            aria-label="Current survey"
            value={survey.id}
            onChange={(e) => void openSurvey(e.target.value)}
          >
            {survey.source === "RUNTIME" &&
              !recent.some((s) => s.id === survey.id) && (
                <option value={survey.id}>{survey.name}</option>
              )}
            {recent.length > 0 && (
              <optgroup label="Runtime surveys">
                {recent.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Illustrative surveys">
              <option value="epitomeNavigated">
                Epitome · harbour approach
              </option>
              <option value="epitomeNoNavigation">Epitome · sonar only</option>
            </optgroup>
          </select>
        </div>
        <div className="mission-status">
          {survey.source === "PRESENTATION" && <IllustrativeNote compact />}
          <span className="service-state">
            <i data-connected={connection === "Service connected"} />
            {connection === "Detached preview"
              ? "Analysis Service offline"
              : connection}
          </span>
        </div>
      </div>
      <Outlet />
      {!isMap && (
        <footer className="workspace-footer">
          <span>Aqualens</span>
          <span>SIDE-SCAN SONAR INTELLIGENCE</span>
          <Link to="/workspace/report">
            Survey record
            <ArrowUpRight size={12} />
          </Link>
        </footer>
      )}
    </div>
  );
}
