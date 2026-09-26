import type {
  Benchmark,
  Detection,
  DetectionKind,
  LayerMode,
  MemoryStats,
  Mission,
  ModelVersion,
  Paged,
  Review,
  ReviewVerdict,
  SonarFrame,
  Survey,
  SurveyChange,
  UnifiedClass,
} from "./api-types";
import { API_V1_BASE_URL as API_BASE_URL } from "./api-config";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiClientError(
      body?.error?.message ?? `Backend unavailable at ${API_BASE_URL}`,
      body?.error?.code ?? "INTERNAL",
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export function parseDetection(value: unknown): Detection {
  if (!value || typeof value !== "object") {
    throw new TypeError("Detection payload must be an object.");
  }
  const detection = value as Detection;
  if (!detection.detection_id || !detection.geometry?.bbox_frame_px) {
    throw new TypeError("Detection payload is missing canonical fields.");
  }
  if (
    detection.kind === "UNKNOWN" &&
    (detection.category !== "UNKNOWN_ANOMALY_CANDIDATE" ||
      detection.class_confidence !== null)
  ) {
    throw new TypeError("UNKNOWN detections cannot carry class confidence.");
  }
  for (const channel of [
    detection.evidence.persistence,
    detection.evidence.shadow,
    detection.evidence.context,
  ]) {
    if (!channel.applicable && (!channel.reason || channel.score !== null)) {
      throw new TypeError(
        "Unavailable evidence requires a reason and null score.",
      );
    }
  }
  return detection;
}

export interface DetectionQuery {
  kind?: DetectionKind;
  category?: UnifiedClass;
  min_confidence?: number;
  change_status?: string;
  review?: string;
  sort?: "priority" | "confidence";
  offset?: number;
  limit?: number;
}

export interface ReviewInput {
  verdict: ReviewVerdict;
  corrected_class?: UnifiedClass;
  corrected_bbox_px?: [number, number, number, number];
  notes?: string;
  reviewer: string;
}

export interface WorkstationService {
  listMissions(): Promise<Mission[]>;
  getSurvey(id: string): Promise<Survey>;
  listSurveys(): Promise<Survey[]>;
  listFrames(surveyId: string, offset?: number, limit?: number): Promise<SonarFrame[]>;
  listDetections(surveyId: string, query?: DetectionQuery): Promise<Paged<Detection>>;
  getDetection(id: string): Promise<Detection>;
  submitReview(id: string, input: ReviewInput): Promise<Review>;
  getReviews(id: string): Promise<Review[]>;
  compare(
    baselineSurveyId: string,
    newSurveyId: string,
    confirmedOnly: boolean,
  ): Promise<{ comparison_id: string; summary: Record<string, number>; changes: SurveyChange[] }>;
  getModels(): Promise<ModelVersion[]>;
  getBenchmark(): Promise<Benchmark | null>;
  getMemoryStats(): Promise<MemoryStats>;
  getMemoryQueue(queue: "hard-negatives" | "corrections" | "hard-positives", limit?: number): Promise<Detection[]>;
  ingestSurvey(id: string): Promise<{ job_id: string }>;
  uploadSurvey(file: File): Promise<{ upload_id: string; job_id: string; state: string }>;
  reportUrl(surveyId: string, format: "json" | "csv"): string;
  rasterUrl(frameId: string, layer: Exclude<LayerMode, "detections" | "change">): string;
}

export const apiService: WorkstationService = {
  listMissions: () => request<Mission[]>("/missions"),
  getSurvey: (id) => request<Survey>(`/surveys/${id}`),
  listSurveys: async () => {
    const missions = await request<(Mission & { surveys?: Survey[] })[]>("/missions");
    return missions.flatMap((mission) => mission.surveys ?? []);
  },
  listFrames: (surveyId, offset = 0, limit = 50) =>
    request<SonarFrame[]>(
      `/surveys/${surveyId}/frames?offset=${offset}&limit=${limit}`,
    ),
  listDetections: async (surveyId, query = {}) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) params.set(key, String(value));
    });
    const payload = await request<Paged<unknown>>(
      `/surveys/${surveyId}/detections?${params}`,
    );
    return { ...payload, items: payload.items.map(parseDetection) };
  },
  getDetection: async (id) => parseDetection(await request(`/detections/${id}`)),
  submitReview: (id, input) =>
    request<Review>(`/detections/${id}/reviews`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getReviews: (id) => request<Review[]>(`/detections/${id}/reviews`),
  compare: (baseline_survey_id, new_survey_id, confirmed_only) =>
    request("/compare", {
      method: "POST",
      body: JSON.stringify({
        baseline_survey_id,
        new_survey_id,
        confirmed_only,
      }),
    }),
  getModels: () => request<ModelVersion[]>("/models"),
  getBenchmark: async () => {
    try {
      return await request<Benchmark>("/benchmarks");
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "NOT_FOUND") return null;
      throw error;
    }
  },
  getMemoryStats: () => request<MemoryStats>("/memory/stats"),
  getMemoryQueue: (queue, limit = 50) =>
    request<Detection[]>(`/memory/queues/${queue}?limit=${limit}`).then((items) => items.map(parseDetection)),
  ingestSurvey: (id) => request<{ job_id: string }>(`/surveys/${id}/ingest`, { method: "POST" }),
  uploadSurvey: async (file) => {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch(`${API_BASE_URL}/surveys/upload`, { method: "POST", body });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new ApiClientError(payload?.error?.message ?? "Upload failed.", payload?.error?.code ?? "INTERNAL", response.status);
    }
    return response.json() as Promise<{ upload_id: string; job_id: string; state: string }>;
  },
  reportUrl: (surveyId, format) => `${API_BASE_URL}/surveys/${surveyId}/report?format=${format}`,
  rasterUrl: (frameId, layer) =>
    `${API_BASE_URL}/frames/${frameId}/raster?layer=${layer}`,
};
