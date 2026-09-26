import type { Detection, LayerMode, SonarFrame } from "@/lib/types";
import type { ViewTransform } from "@/lib/view/geometry";
import { CHANGE_STATUS_ACCENT } from "@/lib/view/labels";

/**
 * Pure canvas painters. No React, no data fetching, no fallback imagery.
 *
 * These are separated from the viewport component so they can be unit tested
 * against a 2D context stub, and so the overlay pass can be reasoned about
 * independently of the raster pass.
 */

const CSS = {
  abyss: "#0a1116",
  nadirBand: "#05080b",
  nadirLine: "rgba(217,164,65,0.45)",
  grid: "rgba(232,236,232,0.06)",
  portLabel: "rgba(126,201,194,0.7)",
  starboardLabel: "rgba(224,168,90,0.8)",
  nadirLabel: "rgba(217,164,65,0.85)",
  known: "#3ea89a",
  unknown: "#e0a85a",
  knownFill: "rgba(62,168,154,0.12)",
  unknownFill: "rgba(224,168,90,0.12)",
  labelText: "#101820",
  verdictBg: "rgba(16,24,32,0.85)",
  verdictText: "#e7ece8",
  /** Neutral fill for the two channels when no raster is loaded. */
  portPlate: "#12222b",
  starboardPlate: "#1e2118",
};

export function clearStage(ctx: CanvasRenderingContext2D, width: number, height: number, ratio: number) {
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = CSS.abyss;
  ctx.fillRect(0, 0, width, height);
}

export function drawRaster(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  frame: SonarFrame,
  mode: LayerMode,
) {
  ctx.filter = mode === "enhanced" ? "contrast(1.28) brightness(1.06)" : "none";
  ctx.drawImage(image, 0, 0, frame.width_px, frame.height_px);
  ctx.filter = "none";
}

/**
 * Drawn only when no raster is available for the frame.
 *
 * This is frame geometry taken from the contract: the nadir offset, the two
 * channels, and the direction of increasing range. It deliberately uses flat
 * plates rather than a seabed-like texture, so it cannot be mistaken for sonar
 * imagery in a screenshot.
 */
export function drawFrameGeometry(
  ctx: CanvasRenderingContext2D,
  frame: SonarFrame,
  transform: ViewTransform,
  fontFamily: string,
) {
  const { width_px: w, height_px: h } = frame;
  const nadir = frame.geometry.nadir_offset_px;

  if (nadir === null) {
    // Nadir is not recoverable, so the two channels cannot be separated. Draw a
    // single undivided plate rather than guessing a centre line.
    ctx.fillStyle = CSS.portPlate;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = CSS.portPlate;
    ctx.fillRect(0, 0, w, nadir);
    ctx.fillStyle = CSS.starboardPlate;
    ctx.fillRect(0, nadir, w, h - nadir);
    ctx.fillStyle = CSS.nadirBand;
    ctx.fillRect(0, nadir - 10, w, 20);
    ctx.strokeStyle = CSS.nadirLine;
    ctx.lineWidth = 2 / transform.scale;
    ctx.beginPath();
    ctx.moveTo(0, nadir);
    ctx.lineTo(w, nadir);
    ctx.stroke();
  }

  ctx.strokeStyle = CSS.grid;
  ctx.lineWidth = 1 / transform.scale;
  for (let x = 0; x < w; x += 250) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  ctx.font = `${14 / transform.scale}px ${fontFamily}`;
  ctx.fillStyle = CSS.portLabel;
  ctx.fillText("PORT, range increasing up", 24, 36);
  ctx.fillStyle = CSS.starboardLabel;
  ctx.fillText("STARBOARD, range increasing down", 24, h - 20);
  if (nadir !== null) {
    ctx.fillStyle = CSS.nadirLabel;
    ctx.fillText("NADIR", 24, nadir - 14);
  }
}

export function drawDetectionOverlays(
  ctx: CanvasRenderingContext2D,
  detections: Detection[],
  options: {
    mode: LayerMode;
    selectedId: string | null;
    transform: ViewTransform;
    fontFamily: string;
    /** Latest verdict per detection id, resolved by the caller. */
    verdictFor?: (detection: Detection) => string | null;
  },
) {
  const { mode, selectedId, transform, fontFamily, verdictFor } = options;
  const s = transform.scale;

  detections.forEach((detection) => {
    const [x, y, width, height] = detection.geometry.bbox_frame_px;
    const selected = detection.detection_id === selectedId;
    const unknown = detection.kind === "UNKNOWN";
    const changeAccent = detection.change_status ? CHANGE_STATUS_ACCENT[detection.change_status] : null;
    const color =
      mode === "change"
        ? changeAccent ?? CSS.unknown
        : unknown
          ? CSS.unknown
          : CSS.known;

    ctx.save();
    if (selected) {
      ctx.fillStyle = unknown ? CSS.unknownFill : CSS.knownFill;
      ctx.fillRect(x, y, width, height);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = (selected ? 3 : 1.5) / s;
    // Dashed outline is reserved for UNKNOWN, so an open-set candidate is never
    // drawn the same way as a classified detection.
    ctx.setLineDash(unknown ? [10 / s, 7 / s] : []);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);

    const label =
      mode === "change"
        ? detection.change_status ?? "NO CHANGE RECORD"
        : unknown
          ? "UNKNOWN ANOMALY"
          : detection.category;

    ctx.font = `600 ${13 / s}px ${fontFamily}`;
    const labelWidth = ctx.measureText(label).width + 16 / s;
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 22 / s, labelWidth, 22 / s);
    ctx.fillStyle = CSS.labelText;
    ctx.fillText(label, x + 8 / s, y - 6 / s);

    const verdict = verdictFor ? verdictFor(detection) : detection.review.latest_verdict;
    if (verdict) {
      ctx.fillStyle = CSS.verdictBg;
      const verdictWidth = ctx.measureText(verdict).width + 14 / s;
      ctx.fillRect(x + width - verdictWidth, y + height, verdictWidth, 20 / s);
      ctx.fillStyle = CSS.verdictText;
      ctx.fillText(verdict, x + width - verdictWidth + 7 / s, y + height + 14 / s);
    }
    ctx.restore();
  });
}

export function hitTest(
  detections: Detection[],
  imageX: number,
  imageY: number,
): Detection | undefined {
  return [...detections].reverse().find((detection) => {
    const [x, y, width, height] = detection.geometry.bbox_frame_px;
    return imageX >= x && imageX <= x + width && imageY >= y && imageY <= y + height;
  });
}
