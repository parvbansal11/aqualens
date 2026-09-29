/**
 * Where a Contact's pixels come from.
 *
 * Real Contacts: the backend's own detection box on the backend-served source raster.
 * Demo Contacts: the deterministic backend fixture carries no rasters, so the workspace shows
 * ILLUSTRATIVE imagery behind them. It is never evidence of that Contact: the viewer labels it,
 * and every value about the Contact (machine class, score, evidence, analyst verdict, history)
 * still comes from the backend. This table is the only place imagery is chosen for demo records.
 */
import { assetUrl } from "./config";
import type { Contact, Survey } from "./types";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Imagery {
  frameId: string;
  src: string;
  width: number;
  height: number;
  /** Real Contacts: the detector box. Illustrative imagery: a framing region, not a detection. */
  box: Box;
  label: string;
  nadirCol: number | null;
  /** Axis statement, shown only where it is true for this raster. */
  axes: string | null;
  illustrative: boolean;
  credit: string | null;
}

const AI4 = "Not this Contact's data · AI4Shipwrecks, CC BY 4.0";

const DEMO_IMAGERY: Record<string, Omit<Imagery, "illustrative">> = {
  demo_contact_a: {
    frameId: "illustrative-a",
    src: "/sonar/barge-02.png",
    width: 1728,
    height: 853,
    box: { x: 148, y: 84, w: 42, h: 42 },
    label: "",
    nadirCol: 865,
    axes: "Rows are pings · columns are slant range",
    credit: AI4,
  },
  demo_contact_b: {
    frameId: "illustrative-b",
    src: "/sonar/barge-01.png",
    width: 1728,
    height: 773,
    box: { x: 1084, y: 208, w: 52, h: 88 },
    label: "",
    nadirCol: 865,
    axes: "Rows are pings · columns are slant range",
    credit: AI4,
  },
  // A retained real SubPipe frame. The region is the frozen detector's own PIPELINE box on this
  // frame (recovery off). The demo Contact's score and evidence are fixture values from the backend.
  demo_contact_c: {
    frameId: "illustrative-c",
    src: "/sonar/subpipe-hf-f08e01eb.png",
    width: 5000,
    height: 500,
    box: { x: 3766, y: 0, w: 242, h: 162 },
    label: "SubPipe frame",
    nadirCol: null,
    axes: null,
    credit: "Real SubPipe frame, GPL-3.0 · box from the frozen detector's PIPELINE output · Contact values are fixture data",
  },
};

export function imageryFor(contact: Contact, surveys: Survey[]): Imagery | null {
  if (contact.demo) {
    const d = DEMO_IMAGERY[contact.contact_id];
    return d ? { ...d, illustrative: true } : null;
  }
  const det = contact.detections[0];
  if (!det) return null;
  const survey = surveys.find((s) => s.survey_ref === det.survey_ref);
  const frame = survey?.frames.find((f) => f.frame_id === det.frame_ref);
  if (!frame?.raster_url || !frame.width_px || !frame.height_px) return null;
  const [x1, y1, x2, y2] = det.bbox;
  return {
    frameId: `${det.survey_ref}/${det.frame_ref}`,
    src: assetUrl(frame.raster_url),
    width: frame.width_px,
    height: frame.height_px,
    box: { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) },
    label: det.source_image || frame.frame_id,
    nadirCol: null,
    axes: null,
    illustrative: false,
    credit: null,
  };
}
