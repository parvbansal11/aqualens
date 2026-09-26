import type {
  Benchmark,
  Detection,
  Review,
  ReviewVerdict,
  UnifiedClass,
} from "@/lib/api-types";
import type {
  DetectionQuery,
  ReviewInput,
  WorkstationService,
} from "@/lib/api-client";
import {
  comparisonChanges,
  detections,
  frames,
  missions,
  modelVersions,
  reviews,
  surveys,
} from "./data";

const wait = (duration = 90) =>
  new Promise<void>((resolve) => setTimeout(resolve, duration));

let reviewHistory: Review[] = [...reviews];
let currentDetections: Detection[] = structuredClone(detections);

function matchesQuery(item: Detection, query: DetectionQuery): boolean {
  if (query.kind && item.kind !== query.kind) return false;
  if (query.category && item.category !== query.category) return false;
  if (
    query.min_confidence !== undefined &&
    (item.fusion.final_confidence ?? 0) < query.min_confidence
  ) {
    return false;
  }
  if (query.change_status && item.change_status !== query.change_status) return false;
  if (query.review === "none" && item.review.review_count > 0) return false;
  if (query.review === "reviewed" && item.review.review_count === 0) return false;
  return true;
}

export const fixtureService: WorkstationService = {
  async listMissions() {
    await wait();
    return structuredClone(missions);
  },
  async getSurvey(id) {
    await wait();
    const survey = surveys.find((item) => item.survey_id === id);
    if (!survey) throw new Error(`Survey ${id} was not found.`);
    return structuredClone(survey);
  },
  async listSurveys() {
    await wait();
    return structuredClone(surveys);
  },
  async listFrames(surveyId, offset = 0, limit = 50) {
    await wait();
    return structuredClone(
      frames
        .filter((item) => item.survey_id === surveyId)
        .slice(offset, offset + limit),
    );
  },
  async listDetections(surveyId, query = {}) {
    await wait();
    const filtered = currentDetections
      .filter((item) => item.survey_id === surveyId)
      .filter((item) => matchesQuery(item, query))
      .sort((a, b) =>
        query.sort === "confidence"
          ? (b.fusion.final_confidence ?? 0) - (a.fusion.final_confidence ?? 0)
          : (a.priority.rank ?? Number.MAX_SAFE_INTEGER) - (b.priority.rank ?? Number.MAX_SAFE_INTEGER),
      );
    return {
      items: structuredClone(
        filtered.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 50)),
      ),
      total: filtered.length,
    };
  },
  async getDetection(id) {
    await wait();
    const detection = currentDetections.find((item) => item.detection_id === id);
    if (!detection) throw new Error(`Detection ${id} was not found.`);
    return structuredClone(detection);
  },
  async submitReview(id: string, input: ReviewInput) {
    await wait(260);
    const detection = currentDetections.find((item) => item.detection_id === id);
    if (!detection) throw new Error(`Detection ${id} was not found.`);
    const review: Review = {
      review_id: `rev_dev_${reviewHistory.length + 1}`,
      detection_id: id,
      verdict: input.verdict as ReviewVerdict,
      corrected_class:
        (input.corrected_class as UnifiedClass | undefined) ?? null,
      corrected_bbox_px: input.corrected_bbox_px ?? null,
      notes: input.notes ?? "",
      reviewer: input.reviewer,
      created_at: new Date().toISOString(),
      model_version_id_at_prediction: detection.model.model_version_id,
      confidence_at_prediction: detection.model.confidence_at_prediction,
      training_eligible: false,
      training_eligible_reason:
        "DEV_FIXTURE reviews are session-only and cannot enter training.",
      included_in_snapshots: [],
      provenance: "OPERATOR_PROVIDED",
    };
    reviewHistory = [...reviewHistory, review];
    currentDetections = currentDetections.map((item) =>
      item.detection_id === id
        ? {
            ...item,
            review: {
              latest_verdict: review.verdict,
              review_count: item.review.review_count + 1,
              reviewed_at: review.created_at,
              reviewer: review.reviewer,
            },
          }
        : item,
    );
    return structuredClone(review);
  },
  async getReviews(id) {
    await wait();
    return structuredClone(
      reviewHistory.filter((review) => review.detection_id === id),
    );
  },
  async compare(_baselineSurveyId, _newSurveyId, confirmedOnly) {
    await wait(240);
    const changes = confirmedOnly
      ? comparisonChanges.filter(
          (change) =>
            change.baseline_detection_id === null ||
            change.baseline_confirmed_by_operator,
        )
      : comparisonChanges;
    const summary = Object.fromEntries(
      ["NEW", "UNCHANGED", "REMOVED", "NOT_SURVEYED"].map((status) => [
        status,
        changes.filter((change) => change.status === status).length,
      ]),
    );
    return {
      comparison_id: "cmp_dev_fixture",
      summary,
      changes: structuredClone(changes),
    };
  },
  async getModels() {
    await wait();
    return structuredClone(modelVersions);
  },
  async getBenchmark(): Promise<Benchmark | null> {
    await wait();
    return null;
  },
  async getMemoryStats() {
    throw new Error("Memory statistics are unavailable in test fixtures.");
  },
  async getMemoryQueue() {
    throw new Error("Memory queues are unavailable in test fixtures.");
  },
  async ingestSurvey() {
    await wait();
    return { job_id: "job_dev_fixture" };
  },
  async uploadSurvey() {
    throw new Error("DEV_FIXTURE uploads are disabled; use the real API.");
  },
  reportUrl(surveyId, format) {
    return `/api/v1/surveys/${surveyId}/report?format=${format}`;
  },
  rasterUrl() {
    return "/dev-sonar.svg";
  },
};
