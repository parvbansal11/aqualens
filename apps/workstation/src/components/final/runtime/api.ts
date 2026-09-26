/* The single network boundary.
 *
 * Every failure a judge can hit on a demo machine — a backend that has not
 * started, a laptop that slept, a run that takes longer than a browser is
 * willing to wait — has to arrive here as a named, actionable state rather
 * than the browser's own "Load failed". So this module classifies failures,
 * bounds every request with a timeout, and retries only what is safe to
 * retry: idempotent reads. A write is never repeated on the client's own
 * initiative, because repeating an upload starts a second real inference run
 * and repeating a verdict would append a second entry to an append-only log.
 */

import type {
  ChangeReadiness,
  MemoryEvents,
  MemoryStats,
  ModelCard,
  RuntimeHealth,
  RuntimeJob,
  RuntimeSurvey,
  RuntimeSurveyIndex,
  Verdict,
} from "./types";
import { API_V1_BASE_URL as API_BASE } from "@/lib/api-config";

export { API_BASE };

export const SURVEY_STORAGE_KEY = "sagardrishti.runtimeSurvey";
export const JOB_STORAGE_KEY = "sagardrishti.runtimeJob";

/** How a request failed, in the terms the interface has to explain it in. */
export type FailureKind =
  /** No HTTP response at all: the backend is not reachable from this browser. */
  | "OFFLINE"
  /** A response was still not complete when the deadline passed. */
  | "TIMEOUT"
  /** The backend answered and refused the request (4xx). */
  | "REJECTED"
  /** The backend answered that the record does not exist (404). */
  | "NOT_FOUND"
  /** The backend answered but failed while handling the request (5xx). */
  | "SERVER"
  /** A response arrived that was not the JSON this endpoint contracts to send. */
  | "MALFORMED";

export class ApiError extends Error {
  readonly kind: FailureKind;
  readonly status: number | null;
  /** The backend's own machine-readable error code, when it sent one. */
  readonly code: string | null;
  readonly detail: Record<string, unknown> | null;

  constructor(
    kind: FailureKind,
    message: string,
    options: { status?: number | null; code?: string | null; detail?: Record<string, unknown> | null } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.detail = options.detail ?? null;
  }

  /** True when repeating the identical request could reasonably succeed. */
  get retryable(): boolean {
    return this.kind === "OFFLINE" || this.kind === "TIMEOUT" || this.kind === "SERVER";
  }
}

/** Plain-language failure text, so no screen has to compose one itself. */
export function failureSentence(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : "The request could not be completed.";
  }
  switch (error.kind) {
    case "OFFLINE":
      return "The analysis service is not reachable from this browser. Nothing was sent, and no survey state was changed.";
    case "TIMEOUT":
      return "The analysis service did not answer in time. It may still be working; nothing here was changed.";
    case "NOT_FOUND":
      return error.message;
    case "REJECTED":
      return error.message;
    case "SERVER":
      return `The analysis service failed while handling the request${error.status ? ` (${error.status})` : ""}. ${error.message}`;
    case "MALFORMED":
      return "The analysis service returned a response this build does not recognise.";
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;
/** Inference over a large bundle legitimately takes a while to be accepted. */
const UPLOAD_TIMEOUT_MS = 180_000;
const RETRY_DELAYS_MS = [400, 1_200];

type RequestOptions = {
  method?: "GET" | "POST";
  body?: BodyInit;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Retries are opt-in and only ever used for reads. */
  retries?: number;
  signal?: AbortSignal;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readError(response: Response): Promise<{ code: string | null; message: string; detail: Record<string, unknown> | null }> {
  try {
    const body = await response.json();
    const error = body?.error;
    if (error && typeof error.message === "string") {
      return { code: error.code ?? null, message: error.message, detail: error.detail ?? null };
    }
  } catch {
    /* fall through to the status-only message */
  }
  return { code: null, message: `The service answered ${response.status}.`, detail: null };
}

async function attempt<T>(path: string, options: RequestOptions): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const external = options.signal;
  const forward = () => controller.abort();
  external?.addEventListener("abort", forward);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      body: options.body,
      headers: options.headers,
      signal: controller.signal,
    });
  } catch (cause) {
    // fetch rejects for both a network failure and an abort; only the deadline
    // we set makes it a timeout, and only then.
    const aborted = controller.signal.aborted;
    if (aborted && !external?.aborted) {
      throw new ApiError("TIMEOUT", `No response within ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw new ApiError("OFFLINE", cause instanceof Error ? cause.message : "The service could not be reached.");
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", forward);
  }

  if (!response.ok) {
    const { code, message, detail } = await readError(response);
    const kind: FailureKind =
      response.status === 404 ? "NOT_FOUND" : response.status >= 500 ? "SERVER" : "REJECTED";
    throw new ApiError(kind, message, { status: response.status, code, detail });
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("MALFORMED", "The response was not valid JSON.", { status: response.status });
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  // A write is never retried here. Retrying an upload starts a second real
  // inference run; retrying a verdict appends a second entry to an append-only
  // log. Both have to stay the operator's explicit decision.
  const retries = method === "GET" ? (options.retries ?? RETRY_DELAYS_MS.length) : 0;
  let lastError: unknown;
  for (let attemptIndex = 0; attemptIndex <= retries; attemptIndex += 1) {
    try {
      return await attempt<T>(path, options);
    } catch (cause) {
      lastError = cause;
      const recoverable = cause instanceof ApiError && cause.retryable;
      if (!recoverable || attemptIndex === retries || options.signal?.aborted) break;
      await sleep(RETRY_DELAYS_MS[Math.min(attemptIndex, RETRY_DELAYS_MS.length - 1)]);
    }
  }
  throw lastError;
}

/* ------------------------------------------------------------------ reads */

export function fetchHealth(signal?: AbortSignal): Promise<RuntimeHealth> {
  // Health is the reconnect probe, so it fails fast and does not retry: the
  // caller's own polling interval is the retry.
  return request<RuntimeHealth>("/runtime/health", { timeoutMs: 6_000, retries: 0, signal });
}

export function fetchJob(jobId: string, signal?: AbortSignal): Promise<RuntimeJob> {
  return request<RuntimeJob>(`/jobs/${jobId}`, { timeoutMs: 8_000, retries: 1, signal });
}

export function fetchRuntimeSurvey(surveyId: string, signal?: AbortSignal): Promise<RuntimeSurvey> {
  return request<RuntimeSurvey>(`/runtime/surveys/${surveyId}`, { signal });
}

export function fetchRuntimeSurveyIndex(limit = 12, signal?: AbortSignal): Promise<RuntimeSurveyIndex> {
  return request<RuntimeSurveyIndex>(`/runtime/surveys?limit=${limit}`, { signal });
}

export function fetchModelCard(signal?: AbortSignal): Promise<ModelCard> {
  return request<ModelCard>("/runtime/model-card", { signal });
}

export function fetchChangeReadiness(
  surveyId: string,
  baselineSurveyId?: string | null,
  signal?: AbortSignal,
): Promise<ChangeReadiness> {
  const query = baselineSurveyId ? `?baseline_survey_id=${encodeURIComponent(baselineSurveyId)}` : "";
  return request<ChangeReadiness>(`/runtime/surveys/${surveyId}/change${query}`, { signal });
}

export function fetchMemoryStats(signal?: AbortSignal): Promise<MemoryStats> {
  return request<MemoryStats>("/runtime/memory/stats", { signal });
}

export function fetchMemoryEvents(surveyId?: string | null, limit = 100, signal?: AbortSignal): Promise<MemoryEvents> {
  const scope = surveyId ? `&survey_id=${encodeURIComponent(surveyId)}` : "";
  return request<MemoryEvents>(`/runtime/memory/reviews?limit=${limit}${scope}`, { signal });
}

/* ----------------------------------------------------------------- writes */

/** POST /api/v1/surveys/upload — accepted, not completed. Never auto-retried. */
export async function uploadSurvey(file: File, signal?: AbortSignal): Promise<{
  upload_id: string;
  job_id: string;
  survey_id: string;
  state: RuntimeJob["state"];
  source_frame_count?: number;
  navigation_status?: "AVAILABLE" | "UNAVAILABLE";
}> {
  const body = new FormData();
  body.append("file", file);
  return request("/surveys/upload", { method: "POST", body, timeoutMs: UPLOAD_TIMEOUT_MS, signal });
}

/** Append-only review write. The queue shows a verdict only once this returns. */
export function postReview(surveyId: string, findingId: string, verdict: Verdict, reviewer: string) {
  return request(`/runtime/surveys/${surveyId}/findings/${findingId}/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verdict, reviewer }),
  });
}

/* ------------------------------------------------------------------- urls */

/** The export as a blob, with the same failure classification as every read.
 * A download is a binary response, so it cannot go through the JSON path. */
export async function fetchReportBlob(url: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new ApiError("OFFLINE", cause instanceof Error ? cause.message : "The service could not be reached.");
  }
  if (!response.ok) {
    const { code, message } = await readError(response);
    throw new ApiError(response.status === 404 ? "NOT_FOUND" : response.status >= 500 ? "SERVER" : "REJECTED", message, {
      status: response.status,
      code,
    });
  }
  return response.blob();
}

export function rasterUrl(surveyId: string, frameId: string) {
  return `${API_BASE}/runtime/surveys/${surveyId}/frames/${frameId}/raster`;
}

export type ReportScope = "contacts" | "observations";

export function reportUrl(surveyId: string, format: "json" | "csv", scope: ReportScope = "contacts") {
  const suffix = format === "csv" ? `&scope=${scope}` : "";
  return `${API_BASE}/runtime/surveys/${surveyId}/report?format=${format}${suffix}`;
}
