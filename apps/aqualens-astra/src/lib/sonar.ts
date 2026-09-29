/**
 * Real side-scan sonar from AI4Shipwrecks (CC BY 4.0), copied byte-identical from the Aqualens repository.
 * Both barge rasters are dual-channel waterfalls with nadir at the centre column (port left, starboard right).
 */
export const SONAR = {
  barge01: "/sonar/barge-01.png",
  barge02: "/sonar/barge-02.png",
  bargeDetail: "/sonar/barge-detail.png",
  viatorDetail: "/sonar/viator-detail.png",
} as const;

const cache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(src: string) {
  let pending = cache.get(src);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
    cache.set(src, pending);
  }
  return pending;
}

let waterfall: Promise<HTMLCanvasElement> | null = null;

/** One continuous along-track strip: barge-01 above barge-02 (both 1728 px wide). */
export function loadWaterfall() {
  if (!waterfall) {
    waterfall = Promise.all([loadImage(SONAR.barge01), loadImage(SONAR.barge02)]).then(([a, b]) => {
      const canvas = document.createElement("canvas");
      canvas.width = a.naturalWidth;
      canvas.height = a.naturalHeight + b.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(a, 0, 0);
      ctx.drawImage(b, 0, a.naturalHeight);
      return canvas;
    });
  }
  return waterfall;
}

/**
 * The small elongated return with its acoustic shadow in barge-01 (starboard side), in raster pixels.
 * Used by the problem section to show how little a real target occupies. The bracket drawn around it is illustrative.
 */
export const SMALL_TARGET = { x: 1088, y: 212, w: 46, h: 82 };
