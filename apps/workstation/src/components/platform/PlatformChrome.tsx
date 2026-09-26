"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, Binary, GitCompareArrows, Microscope, Radar, Ship } from "lucide-react";
import { Wordmark } from "@/components/public/Wordmark";
import { dataOrigin } from "@/lib/services";
import type { Survey } from "@/lib/types";
import { LEVEL_LABELS } from "@/lib/view/labels";

const navItems = [
  { href: "/app", label: "Mission", icon: Ship },
  { href: "/app/workspace", label: "Workspace", icon: Radar },
  { href: "/app/review", label: "Review", icon: Microscope },
  { href: "/app/comparison", label: "Compare", icon: GitCompareArrows },
  { href: "/app/model-lab", label: "Model Lab", icon: Binary },
  { href: "/app/memory", label: "Memory", icon: Archive },
];

/**
 * Header for the operations platform.
 *
 * The mission name and reference level chips are props rather than constants.
 * A parent that has not loaded a survey yet passes null, and the chips render
 * a placeholder instead of a hardcoded corridor name.
 */
export function PlatformChrome({
  missionName,
  survey,
}: {
  missionName: string | null;
  survey: Pick<Survey, "spatial_reference_level" | "level_reason"> | null;
}) {
  const pathname = usePathname();
  const level = survey?.spatial_reference_level;

  return (
    <header className="chrome">
      <Wordmark href="/" />

      <nav aria-label="Primary surfaces">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === "/app" ? pathname === "/app" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={active ? "nav-link active" : "nav-link"}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="chrome-meta">
        <span className="mission-chip">
          {missionName ?? "No mission loaded"}
          <small>Active mission</small>
        </span>
        <span className="ref-chip" title={survey?.level_reason ?? "No survey selected."}>
          {level ? level.split("_")[0] : "--"}
          <small>{level ? LEVEL_LABELS[level].replace(/^L\d /, "") : "Reference unknown"}</small>
        </span>
      </div>
    </header>
  );
}

/**
 * Shown only when the data source is not the live API. It exists so a
 * screenshot can never be mistaken for measured mission data.
 */
export function DataOriginBar() {
  if (dataOrigin === "API") return null;
  return (
    <div className="fixture-bar" role="status">
      DEV_FIXTURE. Contract structures only. Survey rasters and benchmark metrics are not
      present, and every service call in this mode throws rather than returning fabricated
      data.
    </div>
  );
}
