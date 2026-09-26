/**
 * PRESERVE. Single runtime entry point for operational data.
 *
 * Components must import from here and nowhere else. The proxy in
 * src/lib/api/service.ts guarantees that when the data source is set to
 * fixture, every call throws instead of returning fabricated detections.
 */
export { workstationService, dataOrigin } from "../service";
export { ApiClientError, parseDetection } from "../api-client";
export type {
  WorkstationService,
  DetectionQuery,
  ReviewInput,
} from "../api-client";
