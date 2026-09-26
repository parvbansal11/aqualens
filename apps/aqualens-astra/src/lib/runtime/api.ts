import type {
  RuntimeSurvey,
  RuntimeSurveyIndex,
  RuntimeJob,
  RuntimeHealth,
} from "./wire";
import type { UploadAccepted } from "./types";
import { adaptSurvey } from "./adapters";
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);
export const configured = !!API_BASE;
export class RuntimeError extends Error {
  constructor(
    message: string,
    public status: number | null = null,
    public uncertain = false,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
  timeout = 20000,
): Promise<T> {
  if (!configured)
    throw new RuntimeError(
      "The analysis service is not connected in this independent preview.",
    );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new RuntimeError(
        body?.error?.message ?? `The service returned ${response.status}.`,
        response.status,
      );
    }
    return (await response.json()) as T;
  } catch (e) {
    if (e instanceof RuntimeError) throw e;
    throw new RuntimeError(
      options.method === "POST"
        ? "The service did not confirm receipt. Check recent surveys before sending again."
        : "The analysis service could not be reached. You can retry this read.",
      null,
      options.method === "POST",
    );
  } finally {
    clearTimeout(timer);
  }
}
export const health = () => request<RuntimeHealth>("/runtime/health");
export const recentSurveys = () =>
  request<RuntimeSurveyIndex>("/runtime/surveys?limit=12");
export const getSurvey = async (id: string) => {
  const raw = await request<RuntimeSurvey>(
    `/runtime/surveys/${encodeURIComponent(id)}`,
  );
  if (raw.survey_id !== id)
    throw new RuntimeError(
      "The service returned a different survey. Results were not substituted.",
    );
  return adaptSurvey(raw, API_BASE);
};
export const getJob = (id: string) =>
  request<RuntimeJob>(`/jobs/${encodeURIComponent(id)}`);
export function uploadSurvey(file: File) {
  const body = new FormData();
  body.append("file", file);
  return request<UploadAccepted>(
    "/surveys/upload",
    { method: "POST", body },
    180000,
  );
}
// Only a configured runtime can invoke these writes.
// No automatic retry: a review is append-only and an upload starts a new run.
export const appendReview = (
  surveyId: string,
  observationId: string,
  verdict: string,
  reviewer: string,
  notes: string,
) =>
  request(
    `/runtime/surveys/${encodeURIComponent(surveyId)}/findings/${encodeURIComponent(observationId)}/reviews`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict, reviewer, notes }),
    },
  );
export const reportUrl = (
  id: string,
  format: "json" | "csv",
  scope: "contacts" | "observations" = "contacts",
) =>
  `${API_BASE}/runtime/surveys/${encodeURIComponent(id)}/report?format=${format}&scope=${scope}`;

export type RuntimeReport = RuntimeSurvey & {
  provenance: {
    generated_at: string;
    processed_at: string;
    models: Record<string, unknown>;
    navigation: { status: string; note: string };
    review_state: { append_only: boolean; note: string };
    limitations: string[];
  };
};
