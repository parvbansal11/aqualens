import { useNavigate, Link, Navigate } from "react-router-dom";
import { useState } from "react";
import {
  Compass,
  AudioLines,
  Flag,
  Telescope,
  ArrowRight,
  ArrowLeft,
  Check,
} from "lucide-react";
import { roles } from "../lib/runtime/selectors";
import { useWorkspace } from "../lib/store";
import { Logo, ThemeButton } from "../components/ui";
import type { RoleId } from "../lib/runtime/types";
const icons = [Compass, AudioLines, Flag, Telescope];
export default function Roles() {
  const { role, setRole, survey, surveyLoading } = useWorkspace();
  const [selected, setSelected] = useState<RoleId | null>(role);
  const navigate = useNavigate();
  if (surveyLoading)
    return (
      <main className="app-loading" aria-label="Loading survey">
        <span className="loading-echo" />
      </main>
    );
  if (!survey) return <Navigate to="/intake" replace />;
  return (
    <main id="main-content" className="role-page">
      <header>
        <Logo />
        <ThemeButton />
      </header>
      <div className="role-main">
        <p className="eyebrow">ONE SURVEY. FOUR PERSPECTIVES.</p>
        <h1>Choose your station.</h1>
        <p className="role-intro">{survey.name}</p>
        <div
          className="role-options"
          role="group"
          aria-label="Operational station"
        >
          {roles.map((r, i) => {
            const Icon = icons[i];
            return (
              <button
                key={r.id}
                className="role-option"
                aria-pressed={selected === r.id}
                onClick={() => setSelected(r.id)}
              >
                <span className="role-icon">
                  <Icon size={26} />
                </span>
                <span className="role-option-text">
                  <strong>{r.name}</strong>
                  <span>{r.description}</span>
                </span>
                <span className="role-selected">
                  {selected === r.id ? (
                    <Check size={20} />
                  ) : (
                    <ArrowRight size={20} />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className="role-actions">
          <Link to="/intake" className="text-link">
            <ArrowLeft size={16} />
            Change survey
          </Link>
          <button
            className="button"
            disabled={!selected}
            onClick={() => {
              if (selected) {
                setRole(selected);
                navigate("/workspace");
              }
            }}
          >
            Enter Workspace
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
      <footer>
        <span>Aqualens</span>
        <span>A SHARED MISSION. A CLEAR RESPONSIBILITY.</span>
      </footer>
    </main>
  );
}
