export type RoleId = "field" | "analyst" | "supervisor" | "decision";
export type ReviewState =
  "PENDING" | "CONFIRMED" | "REJECTED" | "UNCERTAIN" | "RELABELLED";
export type Position = {
  lat: number;
  lon: number;
  basis: "FRAME_NAVIGATION" | "PRESENTATION";
  depthM: number | null;
  heading: number | null;
};
export type TrackPoint = Position & { id: string; timestamp: string | null };
export type Frame = {
  id: string;
  name: string;
  image: string;
  width: number;
  height: number;
  position: Position | null;
};
export type Observation = {
  id: string;
  frameId: string;
  rawClass: string | null;
  rawScore: number | null;
  displayClass: string | null;
  classificationSource: string;
  productionQualified: boolean;
  box: [number, number, number, number] | null;
  modelId: string | null;
  modelSha: string | null;
  pingStart: number | null;
  pingEnd: number | null;
};
export type EvidenceChannel = {
  id: string;
  label: string;
  state:
    | "SUPPORTS"
    | "WEAK"
    | "CONTRADICTS"
    | "NOT MEASURED"
    | "NOT APPLICABLE"
    | "RECORDED";
  value: number | null;
  detail: string;
};
export type Contact = {
  id: string;
  shortId: string;
  label: string;
  classKey: string;
  observationIds: string[];
  bestObservationId: string | null;
  confidence: number | null;
  evidence: number | null;
  evidenceType: string;
  review: ReviewState;
  position: Position | null;
  persistence: { type: string; score: number | null; frames: number } | null;
  openSet: {
    score: number;
    threshold: number | null;
    candidate: boolean;
    memory: string | null;
    thresholdSource: string | null;
  } | null;
  priority: string | null;
  channels: EvidenceChannel[];
  missingChannels: string[];
};
export type Survey = {
  id: string;
  name: string;
  mission: string | null;
  missionNotes?: string | null;
  createdAt: string | null;
  source: "PRESENTATION" | "RUNTIME";
  description: string;
  frames: Frame[];
  observations: Observation[];
  contacts: Contact[];
  track: (TrackPoint | null)[];
  comparisonSupported: boolean;
};
export type SurveySummary = {
  id: string;
  name: string;
  contacts: number;
  frames: number;
  observations: number;
  createdAt: string | null;
};
export type UploadSelection = {
  file: File;
  rasterCount: number | null;
  navigation: boolean | null;
  mission: boolean | null;
  entries: string[] | null;
  preview: string | null;
};
export type UploadAccepted = {
  job_id: string;
  survey_id: string;
  state: import("./wire").JobState;
  source_frame_count?: number;
};
export type { RuntimeJob, RuntimeHealth } from "./wire";
