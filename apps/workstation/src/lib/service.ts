import { apiService } from "./api-client";
import type { DataOrigin } from "./api-types";
import type { WorkstationService } from "./api-client";

export const dataOrigin: DataOrigin =
  process.env.NODE_ENV === "test" || process.env.NEXT_PUBLIC_DATA_SOURCE === "fixture"
    ? "DEV_FIXTURE"
    : "API";

// Synthetic fixtures are test-importable only. Runtime pages never fall back to fabricated
// detections when the API is unavailable.
const fixtureDisabledService = new Proxy({} as WorkstationService, {
  get: () => async () => {
    throw new Error("DEV_FIXTURE data is test-only; connect the real Stage 3B API.");
  },
});

export const workstationService: WorkstationService =
  dataOrigin === "API" ? apiService : fixtureDisabledService;
