import { Outlet } from "react-router-dom";
import { Logo, ThemeButton } from "./ui";
import { useWorkspace } from "../lib/store";
export default function IntakeShell() {
  const { connection } = useWorkspace();
  return (
    <div className="intake-shell">
      <header className="intake-header">
        <Logo />
        <span className="eyebrow">SURVEY INTAKE</span>
        <div>
          <span className="service-state">
            <i data-connected={connection === "Service connected"} />
            {connection === "Detached preview"
              ? "Analysis Service offline"
              : connection}
          </span>
          <ThemeButton />
        </div>
      </header>
      <Outlet />
    </div>
  );
}
