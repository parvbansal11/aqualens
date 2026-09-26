/** DEMO PRESENTATION FIXTURE
 * NOT MODEL OUTPUT
 * NOT PRODUCTION SURVEY EVIDENCE
 * Real project sonar is used for presentation only. All associations, boxes,
 * evidence values, review states, coordinates, track, heading and depth below
 * are illustrative. The Mumbai map scene is NOT the sonar acquisition site.
 * No detector scores/model provenance are invented or assigned to these images.
 */
import type { Survey, Position, Contact } from "../lib/runtime/types";
const fixes: [number, number, number][] = [
  [18.917, 72.849, 38.2],
  [18.9182, 72.85, 38.8],
  [18.9195, 72.8512, 39.4],
  [18.9208, 72.8525, 40.1],
  [18.922, 72.8539, 41.3],
  [18.9233, 72.8552, 41.8],
  [18.9246, 72.8564, 42.5],
  [18.9259, 72.8577, 43.0],
  [18.9272, 72.859, 43.4],
  [18.9286, 72.8603, 43.1],
  [18.9299, 72.8616, 42.6],
  [18.9312, 72.8629, 42.2],
  [18.9323, 72.8644, 41.6],
  [18.9327, 72.866, 41.0],
  [18.9324, 72.8676, 40.7],
  [18.9314, 72.8684, 40.5],
  [18.9301, 72.868, 40.2],
  [18.9288, 72.8668, 39.9],
  [18.9275, 72.8656, 39.6],
  [18.9262, 72.8644, 39.3],
  [18.9249, 72.8632, 38.9],
  [18.9236, 72.862, 38.3],
  [18.9223, 72.8608, 37.8],
  [18.921, 72.8596, 37.5],
];
const pos = (index: number): Position => ({
  lat: fixes[index][0],
  lon: fixes[index][1],
  depthM: fixes[index][2],
  heading: index < 13 ? 43 : 223,
  basis: "PRESENTATION",
});
const contact = (
  id: string,
  index: number,
  label: string,
  classKey: string,
  ids: string[],
  evidence: number,
): Contact => ({
  id,
  shortId: id,
  label,
  classKey,
  observationIds: ids,
  bestObservationId: ids[0],
  confidence: null,
  evidence,
  evidenceType: "DEMO_PRESENTATION_VALUE",
  review: "PENDING",
  position: pos(index),
  persistence: null,
  openSet: null,
  priority: null,
  channels: [],
  missingChannels: [],
});
const structure = contact(
  "CT-01",
  5,
  "Wreck or structural debris",
  "SHIPWRECK",
  ["OBS-01", "OBS-02", "OBS-03"],
  0.53,
);
structure.persistence = { type: "SEQUENTIAL_PING", score: 0.72, frames: 3 };
structure.openSet = {
  score: 0.57,
  threshold: 0.4616784453392029,
  candidate: true,
  memory: "open_set_v1",
  thresholdSource: "q99.5_annotation_safe_background_val",
};
structure.channels = [
  {
    id: "persistence",
    label: "Temporal persistence",
    state: "SUPPORTS",
    value: 0.72,
    detail: "Illustrative association across three source observations.",
  },
  {
    id: "condition",
    label: "Sonar condition",
    state: "RECORDED",
    value: 0.81,
    detail:
      "Example channel for disclosure design; no raster assessment was run.",
  },
];
const barge = contact(
  "CT-02",
  11,
  "Structural debris",
  "SHIPWRECK",
  ["OBS-04", "OBS-05"],
  0.46,
);
barge.review = "CONFIRMED";
const unusual = contact(
  "CT-03",
  20,
  "Open-set candidate",
  "OPEN_SET",
  ["OBS-06"],
  0.38,
);
unusual.openSet = {
  score: 0.62,
  threshold: 0.4616784453392029,
  candidate: true,
  memory: "open_set_v1",
  thresholdSource: "q99.5_annotation_safe_background_val",
};
export const epitomeNavigated: Survey = {
  id: "epitomeNavigated",
  name: "Epitome · harbour approach",
  mission: "EPITOME / PRESENTATION",
  createdAt: null,
  source: "PRESENTATION",
  description: "A guided look at a connected sonar survey.",
  frames: [
    {
      id: "F-01",
      name: "viator-detail.png",
      image: "/sonar/viator-detail.png",
      width: 1120,
      height: 630,
      position: pos(5),
    },
    {
      id: "F-02",
      name: "viator-03.png",
      image: "/sonar/viator-03.png",
      width: 1728,
      height: 1044,
      position: pos(6),
    },
    {
      id: "F-03",
      name: "barge-detail.png",
      image: "/sonar/barge-detail.png",
      width: 1120,
      height: 630,
      position: pos(7),
    },
    {
      id: "F-04",
      name: "barge-01.png",
      image: "/sonar/barge-01.png",
      width: 1728,
      height: 773,
      position: pos(11),
    },
    {
      id: "F-05",
      name: "barge-02.png",
      image: "/sonar/barge-02.png",
      width: 1728,
      height: 853,
      position: pos(20),
    },
  ],
  observations: [
    ["OBS-01", "F-01"],
    ["OBS-02", "F-02"],
    ["OBS-03", "F-03"],
    ["OBS-04", "F-04"],
    ["OBS-05", "F-05"],
    ["OBS-06", "F-05"],
  ].map(([id, frameId]) => ({
    id,
    frameId,
    rawClass: null,
    rawScore: null,
    displayClass: null,
    classificationSource: "DEMO_PRESENTATION",
    productionQualified: false,
    box: id === "OBS-01" ? [0.42, 0.23, 0.68, 0.68] : null,
    modelId: null,
    modelSha: null,
    pingStart: null,
    pingEnd: null,
  })),
  contacts: [structure, barge, unusual],
  track: fixes.map((_, i) => ({
    ...pos(i),
    id: `FIX-${i + 1}`,
    timestamp: null,
  })),
  comparisonSupported: false,
};
