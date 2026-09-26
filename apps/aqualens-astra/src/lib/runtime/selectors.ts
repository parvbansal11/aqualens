import type { Contact, Observation, RoleId, Survey, Position } from "./types";
export const roles = [
  {
    id: "field",
    name: "Field Officer",
    description: "Plan your next inspection.",
    focus: "Your next inspection starts here.",
  },
  {
    id: "analyst",
    name: "Sonar Analyst",
    description: "Follow the return. Inspect the evidence.",
    focus: "A clearer view of what lies below.",
  },
  {
    id: "supervisor",
    name: "Mission Supervisor",
    description: "Oversee the survey. Set the priorities.",
    focus: "Your mission, in focus.",
  },
  {
    id: "decision",
    name: "Decision Viewer",
    description: "Understand what needs attention.",
    focus: "The findings that matter.",
  },
] as const;
export function isRole(v: string | null): v is RoleId {
  return roles.some((r) => r.id === v);
}
export const permissions = {
  field: ["home", "upload", "processing", "results", "map"],
  analyst: ["home", "upload", "processing", "results", "contact", "map"],
  supervisor: ["home", "upload", "processing", "results", "map"],
  decision: ["home", "upload", "processing", "results"],
} as const;
export function canAccess(role: RoleId, route: string) {
  return (permissions[role] as readonly string[]).includes(route);
}
export const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
export const numberOrNull = (v: unknown) => (finite(v) ? v : null);
export function position(
  lat: unknown,
  lon: unknown,
  depth?: unknown,
  heading?: unknown,
): Position | null {
  if (!finite(lat) || !finite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return null;
  return {
    lat,
    lon,
    depthM: finite(depth) && depth >= 0 ? depth : null,
    heading: finite(heading) && heading >= 0 && heading <= 360 ? heading : null,
    basis: "FRAME_NAVIGATION",
  };
}
export function representative(
  contact: Contact,
  observations: Observation[],
  manual?: string,
): Observation | undefined {
  const associated = contact.observationIds
    .map((id) => observations.find((o) => o.id === id))
    .filter((o): o is Observation => !!o);
  return (
    associated.find((o) => o.id === manual) ??
    associated.find((o) => o.id === contact.bestObservationId) ??
    associated
      .filter((o) => finite(o.rawScore))
      .reduce<Observation | undefined>(
        (best, o) => (!best || o.rawScore! > best.rawScore! ? o : best),
        undefined,
      ) ??
    associated[0]
  );
}
export function capabilities(survey: Survey | null) {
  return {
    navigation:
      !!survey &&
      (survey.track.some(Boolean) || survey.contacts.some((c) => c.position)),
    depth: !!survey && survey.track.some((p) => p?.depthM != null),
    persistence:
      !!survey &&
      survey.contacts.some((c) => c.persistence?.type === "SEQUENTIAL_PING"),
    openSet: !!survey && survey.contacts.some((c) => c.openSet),
    change: survey?.comparisonSupported === true,
  };
}
export function sortedContacts(s: Survey) {
  return [...s.contacts].sort(
    (a, b) =>
      Number(a.review !== "PENDING" && a.review !== "UNCERTAIN") -
        Number(b.review !== "PENDING" && b.review !== "UNCERTAIN") ||
      (b.confidence ?? b.evidence ?? -Infinity) -
        (a.confidence ?? a.evidence ?? -Infinity),
  );
}
export function contactMetric(contact: Contact) {
  return contact.confidence !== null
    ? { label: "Confidence", value: contact.confidence }
    : { label: "Evidence strength", value: contact.evidence };
}
export function reviewedCount(s: Survey) {
  return s.contacts.filter((c) =>
    ["CONFIRMED", "REJECTED", "RELABELLED"].includes(c.review),
  ).length;
}
export function reviewLabel(state: string) {
  return (
    (
      {
        PENDING: "Needs review",
        CONFIRMED: "Confirmed",
        REJECTED: "Rejected",
        UNCERTAIN: "Needs review",
        RELABELLED: "Relabelled",
      } as Record<string, string>
    )[state] ?? "Needs review"
  );
}
export const score = (n: number | null) => (n === null ? "—" : n.toFixed(2));
export const coordinate = (n: number, lat: boolean) =>
  `${Math.abs(n).toFixed(4)}° ${lat ? (n < 0 ? "S" : "N") : n < 0 ? "W" : "E"}`;
export const classLabel = (raw: string | null | undefined) =>
  (
    ({
      PIPELINE: "Pipeline",
      SHIPWRECK: "Wreck or structural debris",
      CRAB_POT: "Derelict fishing gear",
      OPEN_SET: "Open-set candidate",
    }) as Record<string, string>
  )[raw ?? ""] ??
  raw ??
  "Unclassified Contact";
export function trackSegments(survey: Survey) {
  const segments: NonNullable<Survey["track"][number]>[][] = [];
  let current: NonNullable<Survey["track"][number]>[] = [];
  for (const p of survey.track) {
    if (p) current.push(p);
    else if (current.length) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);
  return segments;
}
