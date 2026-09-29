/**
 * Typed client for the Aqualens product API. Every screen reads and writes through here;
 * no component holds its own copy of backend data. Routes are exactly those in
 * schemas/aqualens-openapi.json.
 */
import { API_BASE, API_ORIGIN } from "./config";
import type {
  Analyst,
  Capabilities,
  Contact,
  ContactPage,
  ContactQuery,
  Health,
  Job,
  MapResponse,
  Mission,
  MissionReport,
  Priority,
  Provenance,
  Readiness,
  ReviewDecision,
  ReviewEvent,
  Survey,
  Upload,
  UploadAccepted,
} from "./types";

/** A failure the workspace can explain to a person. `offline` means the service did not answer at all. */
export class ApiFailure extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number | null,
    public readonly offline = false,
  ) {
    super(message);
  }
}

const HUMAN: Record<string, string> = {
  DEMO_ISOLATION: "Demo and survey records are kept apart, so this action is not available here.",
  DUPLICATE_UPLOAD: "This exact file is already part of the mission.",
  REPORT_NOT_READY: "The report waits until every upload has finished processing.",
  VALIDATION_FAILED: "The request was not accepted. Check the file or the values and try again.",
  UPLOAD_TOO_LARGE: "The file is larger than this workstation accepts.",
  UNREADABLE_BUNDLE: "The bundle could not be read.",
  UNREADABLE_RASTER: "The image could not be read as sonar.",
  UNSAFE_ARCHIVE: "The bundle contains unsafe paths and was not opened.",
  DUPLICATE_ARCHIVE_NAME: "The bundle repeats a file name.",
  INTERNAL_ERROR: "Something went wrong in the local service.",
};

const UNCONFIGURED = () => new ApiFailure("No Aqualens service is configured for this deployment.", "OFFLINE", null, true);

async function request<T>(path: string, init: RequestInit = {}, { raw = false } = {}): Promise<T> {
  if (!API_BASE) throw UNCONFIGURED();
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers: { Accept: "application/json", ...(init.headers ?? {}) } });
  } catch {
    throw new ApiFailure("Aqualens could not reach the local processing service.", "OFFLINE", null, true);
  }
  if (!response.ok) {
    let code = "HTTP_" + response.status;
    let message = response.status === 404 ? "That record was not found." : "The local service could not complete this request.";
    try {
      const body = await response.json();
      if (body?.error?.code) {
        code = body.error.code;
        // The service's own message is specific ("Synthetic navigation cannot enter a real Mission.");
        // the local wording is only a fallback when it sends none.
        message = body.error.message || HUMAN[code] || message;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiFailure(message, code, response.status);
  }
  return (raw ? response : response.json()) as Promise<T>;
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : "";
};

export const api = {
  health: () => request<Health>("/health"),
  readiness: async (): Promise<Readiness> => {
    // Readiness answers 503 with a body when a dependency is missing; that is a state, not a failure.
    if (!API_BASE) throw UNCONFIGURED();
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/readiness`);
    } catch {
      throw new ApiFailure("Aqualens could not reach the local processing service.", "OFFLINE", null, true);
    }
    return response.json();
  },
  capabilities: () => request<Capabilities>("/system/capabilities"),
  provenance: () => request<Provenance>("/system/provenance"),

  missions: () => request<Mission[]>("/missions?limit=200"),
  demoMissions: () => request<{ items: Mission[] }>("/demo/missions").then((r) => r.items),
  mission: (id: string) => request<Mission>(`/missions/${encodeURIComponent(id)}`),
  createMission: (name: string, operator?: string) => request<Mission>("/missions", json({ name, operator: operator || null })),
  surveys: (id: string) => request<{ items: Survey[] }>(`/missions/${encodeURIComponent(id)}/surveys`).then((r) => r.items),
  uploads: (id: string) => request<{ items: Upload[] }>(`/missions/${encodeURIComponent(id)}/uploads`).then((r) => r.items),
  jobs: (id: string) => request<{ items: (Job | null)[] }>(`/missions/${encodeURIComponent(id)}/jobs`).then((r) => r.items.filter((j): j is Job => !!j)),
  job: (id: string) => request<Job>(`/jobs/${encodeURIComponent(id)}`),
  upload: (missionId: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<UploadAccepted>(`/missions/${encodeURIComponent(missionId)}/uploads`, { method: "POST", body });
  },

  contacts: (missionId: string, query: ContactQuery = {}) =>
    request<ContactPage>(`/missions/${encodeURIComponent(missionId)}/contacts${qs({ limit: 200, ...query })}`),
  contact: (id: string) => request<Contact>(`/contacts/${encodeURIComponent(id)}`),
  history: (id: string) => request<{ items: ReviewEvent[] }>(`/contacts/${encodeURIComponent(id)}/history`).then((r) => r.items),

  review: (id: string, actor: string, status: ReviewDecision, note?: string) => request<ReviewEvent>(`/contacts/${encodeURIComponent(id)}/review`, json({ actor, status, note })),
  classify: (id: string, actor: string, classification: Analyst["classification"], note?: string) =>
    request<ReviewEvent>(`/contacts/${encodeURIComponent(id)}/classification`, json({ actor, classification, note })),
  priority: (id: string, actor: string, priority: Priority, note?: string) => request<ReviewEvent>(`/contacts/${encodeURIComponent(id)}/priority`, json({ actor, priority, note })),
  note: (id: string, actor: string, note: string) => request<ReviewEvent>(`/contacts/${encodeURIComponent(id)}/notes`, json({ actor, note })),

  map: (missionId: string) => request<MapResponse>(`/missions/${encodeURIComponent(missionId)}/map`),
  createReport: (missionId: string) => request<MissionReport>(`/missions/${encodeURIComponent(missionId)}/reports`, { method: "POST" }),
  reportUrl: (reportId: string, format: "json" | "html", download = false) =>
    `${API_BASE}/reports/${encodeURIComponent(reportId)}?format=${format}${download ? "&download=true" : ""}`,
  openApiUrl: `${API_ORIGIN}/openapi.json`,
};
