"use client";

import { useEffect, useRef } from "react";

/**
 * Illustrative animation of side-scan frame geometry, for the public pages only.
 *
 * It renders procedural noise in the port and starboard bands either side of a
 * nadir line. It draws no bounding boxes, reads no API, and imports nothing from
 * the operational layer. The caption beside it on the page states that it is an
 * explanation rather than measured evidence.
 *
 * Honours prefers-reduced-motion by drawing a single static frame.
 */
export function SonarSwathCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let offset = 0;
    let raf = 0;

    // Deterministic pseudo noise, so the texture never resembles a target.
    const noise = (i: number) => {
      const s = Math.sin(i * 12.9898) * 43758.5453;
      return s - Math.floor(s);
    };

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) {
        raf = requestAnimationFrame(draw);
        return;
      }
      if (canvas.width !== Math.round(w * ratio)) {
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

      const nadir = h * 0.5;
      const port = ctx.createLinearGradient(0, 0, 0, nadir);
      port.addColorStop(0, "#16323e");
      port.addColorStop(1, "#0b171e");
      const starboard = ctx.createLinearGradient(0, nadir, 0, h);
      starboard.addColorStop(0, "#1a2113");
      starboard.addColorStop(1, "#2e2a1a");
      ctx.fillStyle = port;
      ctx.fillRect(0, 0, w, nadir);
      ctx.fillStyle = starboard;
      ctx.fillRect(0, nadir, w, h - nadir);

      const step = 3;
      const bands = 22;
      const bandHeight = nadir / bands;
      for (let x = 0; x < w; x += step) {
        const i = Math.floor((x + offset) / step);
        for (let band = 0; band < bands; band++) {
          const y = (band / bands) * nadir;
          ctx.fillStyle = `rgba(126,201,194,${(0.03 + noise(i * 31 + band * 7) * 0.11).toFixed(3)})`;
          ctx.fillRect(x, y, step, bandHeight);
          ctx.fillStyle = `rgba(224,168,90,${(0.02 + noise(i * 17 + band * 5 + 991) * 0.1).toFixed(3)})`;
          ctx.fillRect(x, nadir + y, step, bandHeight);
        }
      }

      ctx.fillStyle = "#05080b";
      ctx.fillRect(0, nadir - h * 0.018, w, h * 0.036);
      ctx.strokeStyle = "rgba(217,164,65,0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, nadir);
      ctx.lineTo(w, nadir);
      ctx.stroke();

      ctx.strokeStyle = "rgba(232,236,232,0.05)";
      ctx.lineWidth = 1;
      for (let gx = -((offset * 0.5) % 120); gx < w; gx += 120) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }

      if (!reduce) {
        offset += 1.1;
        raf = requestAnimationFrame(draw);
      }
    };

    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" />;
}
