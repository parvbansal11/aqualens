/* Frontend side of the navigation/mission metadata ingest feature:
 * - runtime/select.ts: heading/timestamp labels never substitute a value.
 * - runtime/zip-peek.ts: pre-upload detection of navigation.csv/mission.json.
 * - AqualensApp.geometryFromFindings: only real recorded positions are
 *   plotted, and nothing here fabricates a coastline or vessel track. */
import { describe, expect, it } from "vitest";
import { geometryFromFindings } from "@/components/final/AqualensApp";
import { headingLabel, timestampLabel } from "@/components/final/runtime/select";
import { zipEntryBasenames } from "@/components/final/runtime/zip-peek";
import type { RuntimeFinding } from "@/components/final/runtime/types";

function finding(overrides: Partial<RuntimeFinding> = {}): RuntimeFinding {
  return {
    detection_id: "det_1",
    survey_id: "survey_1",
    source_frame_id: "frame_0000",
    source_image_path: "/tmp/upload.png",
    tile_id: null,
    raw_class_id: 1,
    raw_class: "SHIPWRECK",
    raw_confidence: 0.5,
    display_class: "SHIPWRECK",
    display_confidence: 0.5,
    classification_source: "MODEL",
    production_qualified: true,
    anomaly_score: null,
    bbox_px: [0, 0, 10, 10],
    bbox_normalized: [0, 0, 0.1, 0.1],
    pixel_dimensions: [100, 100],
    geo: { lat: null, lon: null },
    review_state: null,
    review_history: [],
    model_id: "m",
    model_sha256: "s",
    dataset_snapshot_id: "d",
    run_id: "r",
    ...overrides,
  };
}

/** Hand-built minimal ZIP (STORED, no compression) so zip-peek can be tested
 * against a real central directory without pulling in a zip library. */
function buildZip(entries: Record<string, string>): File {
  const encoder = new TextEncoder();
  const chunks: number[] = [];
  const centralDirectory: number[] = [];
  let offset = 0;

  const pushU16 = (arr: number[], v: number) => arr.push(v & 0xff, (v >> 8) & 0xff);
  const pushU32 = (arr: number[], v: number) => arr.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);

  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Array.from(encoder.encode(name));
    const dataBytes = Array.from(encoder.encode(content));
    const localHeaderOffset = offset;

    const local: number[] = [];
    pushU32(local, 0x04034b50);
    pushU16(local, 20); // version needed
    pushU16(local, 0); // flags
    pushU16(local, 0); // method: stored
    pushU16(local, 0); // mod time
    pushU16(local, 0); // mod date
    pushU32(local, 0); // crc32 (unchecked by zip-peek)
    pushU32(local, dataBytes.length);
    pushU32(local, dataBytes.length);
    pushU16(local, nameBytes.length);
    pushU16(local, 0); // extra length
    local.push(...nameBytes, ...dataBytes);
    chunks.push(...local);
    offset += local.length;

    const central: number[] = [];
    pushU32(central, 0x02014b50);
    pushU16(central, 20);
    pushU16(central, 20);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU32(central, 0);
    pushU32(central, dataBytes.length);
    pushU32(central, dataBytes.length);
    pushU16(central, nameBytes.length);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU32(central, 0);
    pushU32(central, localHeaderOffset);
    central.push(...nameBytes);
    centralDirectory.push(...central);
  }

  const centralDirOffset = offset;
  const all = [...chunks, ...centralDirectory];
  const eocd: number[] = [];
  pushU32(eocd, 0x06054b50);
  pushU16(eocd, 0);
  pushU16(eocd, 0);
  pushU16(eocd, Object.keys(entries).length);
  pushU16(eocd, Object.keys(entries).length);
  pushU32(eocd, centralDirectory.length);
  pushU32(eocd, centralDirOffset);
  pushU16(eocd, 0);
  all.push(...eocd);

  return new File([new Uint8Array(all)], "bundle.zip", { type: "application/zip" });
}

describe("headingLabel / timestampLabel", () => {
  it("renders Unavailable rather than a substituted value", () => {
    expect(headingLabel(finding())).toBe("Unavailable");
    expect(timestampLabel(finding())).toBe("Unavailable");
  });

  it("renders a real heading and timestamp when the frame carries navigation", () => {
    const withNav = finding({ heading_deg: 128.4, timestamp_utc: "2026-09-01T15:30:00Z" });
    expect(headingLabel(withNav)).toBe("128.4°");
    expect(timestampLabel(withNav)).not.toBe("Unavailable");
  });
});

describe("zipEntryBasenames", () => {
  it("detects navigation.csv and mission.json alongside imagery", async () => {
    const zip = buildZip({
      "sonar_0001.png": "not-a-real-png-but-zip-peek-never-reads-content",
      "navigation.csv": "frame,timestamp_utc,latitude,longitude\n",
      "mission.json": "{}",
    });
    const names = await zipEntryBasenames(zip);
    expect(names.has("navigation.csv")).toBe(true);
    expect(names.has("mission.json")).toBe(true);
    expect(names.has("sonar_0001.png")).toBe(true);
  });

  it("reports absence honestly for an image-only bundle", async () => {
    const zip = buildZip({ "sonar_0001.png": "x", "sonar_0002.png": "y" });
    const names = await zipEntryBasenames(zip);
    expect(names.has("navigation.csv")).toBe(false);
    expect(names.has("mission.json")).toBe(false);
  });
});

describe("geometryFromFindings", () => {
  it("is null when no finding carries a real position -- never a fabricated chart", () => {
    expect(geometryFromFindings([finding(), finding({ detection_id: "det_2" })])).toBeNull();
  });

  it("never fabricates coastline, coverage swath or unsurveyed geometry", () => {
    const geometry = geometryFromFindings([finding({ geo: { lat: 18.9, lon: 72.8 } })]);
    expect(geometry).not.toBeNull();
    expect(geometry?.coastline).toBeNull();
    expect(geometry?.swath).toBeNull();
    expect(geometry?.gap).toBeNull();
    expect(geometry?.gapArea).toBeNull();
    expect(geometry?.scaleLabel).toBeNull();
    // With no frame navigation supplied there is no track to draw either.
    expect(geometry?.track).toEqual([]);
  });

  it("draws a track only from frames that actually carry a navigation fix", () => {
    const positioned = finding({ detection_id: "det_pos", geo: { lat: 18.9, lon: 72.8 } });
    const geometry = geometryFromFindings(
      [positioned],
      [
        { frameId: "frame_0000", lat: 18.9, lon: 72.8 },
        { frameId: "frame_0001", lat: 19.0, lon: 72.9 },
      ],
    );
    expect(geometry?.track?.map((point) => point.frameId)).toEqual(["frame_0000", "frame_0001"]);
    // The track shares the marker projection exactly, so the two cannot disagree.
    expect(geometry?.track?.[0].point).toEqual(geometry?.markers[positioned.detection_id]);
  });

  it("plots a track even when no finding carries a position, and never the reverse", () => {
    const geometry = geometryFromFindings([finding()], [{ frameId: "frame_0000", lat: 18.9, lon: 72.8 }]);
    expect(geometry).not.toBeNull();
    expect(Object.keys(geometry!.markers)).toEqual([]);
    expect(geometry!.track).toHaveLength(1);
  });

  it("plots only the findings that carry a real position, centered for a single point", () => {
    const positioned = finding({ detection_id: "det_pos", geo: { lat: 18.9, lon: 72.8 } });
    const unpositioned = finding({ detection_id: "det_none" });
    const geometry = geometryFromFindings([positioned, unpositioned]);
    expect(geometry?.markers[positioned.detection_id]).toEqual([50, 50]);
    expect(geometry?.markers[unpositioned.detection_id]).toBeUndefined();
  });

  it("spreads multiple real positions proportionally across the chart", () => {
    const south = finding({ detection_id: "south", geo: { lat: 18.0, lon: 72.0 } });
    const north = finding({ detection_id: "north", geo: { lat: 19.0, lon: 73.0 } });
    const geometry = geometryFromFindings([south, north]);
    const [southX, southY] = geometry!.markers.south;
    const [northX, northY] = geometry!.markers.north;
    expect(southX).toBeLessThan(northX); // lower longitude renders further left
    expect(southY).toBeGreaterThan(northY); // lower latitude renders lower on the chart
  });
});
