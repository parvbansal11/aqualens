"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { Detection, LayerMode, SonarFrame } from "@/lib/types";
import { fillHeightTransform, fitTransform, zoomAtPoint } from "@/lib/view/geometry";
import type { ViewTransform } from "@/lib/view/geometry";
import { LEVEL_LABELS } from "@/lib/view/labels";
import { clearStage, drawDetectionOverlays, drawFrameGeometry, drawRaster, hitTest } from "./draw";
import { LayerModeTabs } from "./LayerModeTabs";
import { ViewerActions } from "./ViewerActions";

/**
 * The hero surface of the workspace.
 *
 * Component boundaries, as required by the handoff:
 *   raster        -> loaded from rasterUrl, drawn by drawRaster
 *   geometry      -> drawn by drawFrameGeometry only when no raster exists
 *   overlays      -> drawn by drawDetectionOverlays
 *   selection     -> hitTest plus the onSelect callback
 *   mode switching-> LayerModeTabs
 *   actions       -> ViewerActions
 *   timeline      -> PingTimeline, a sibling rather than a child
 *
 * This component fetches nothing. rasterUrl is supplied by the page, which gets
 * it from workstationService.rasterUrl, so the viewport has no knowledge of the
 * API base URL and no bundled imagery of its own.
 */
export function SonarViewport({
  frame,
  detections,
  selectedId,
  onSelect,
  rasterUrl,
  changeAvailable = true,
  verdictFor,
}: {
  frame: SonarFrame;
  detections: Detection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Null means no raster exists for this frame and layer. */
  rasterUrl: (frame: SonarFrame, layer: "raw" | "enhanced") => string | null;
  changeAvailable?: boolean;
  verdictFor?: (detection: Detection) => string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; origin: ViewTransform } | null>(null);

  const [mode, setMode] = useState<LayerMode>("detections");
  const [overlaysVisible, setOverlaysVisible] = useState(true);
  const [transform, setTransform] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ ping: number; across: number } | null>(null);

  const rasterLayer: "raw" | "enhanced" = mode === "enhanced" ? "enhanced" : "raw";
  const url = useMemo(() => rasterUrl(frame, rasterLayer), [frame, rasterLayer, rasterUrl]);
  /* Readiness is which url actually decoded, so a new src is not "ready" until
   * its own load lands and a failed load falls through to the geometry painter. */
  const imageReady = Boolean(url) && loadedUrl === url;

  const fill = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setTransform(fillHeightTransform(canvas.clientHeight, frame.height_px));
  }, [frame.height_px]);

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setTransform(
      fitTransform(canvas.clientWidth, canvas.clientHeight, frame.width_px, frame.height_px),
    );
  }, [frame.height_px, frame.width_px]);

  // Raster loading. A failure leaves imageRef null, which falls through to the
  // geometry painter and the plaque, never to a substitute picture.
  useEffect(() => {
    imageRef.current = null;
    if (!url) return;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = url;
    image.onload = () => {
      imageRef.current = image;
      setLoadedUrl(url);
    };
    image.onerror = () => {
      imageRef.current = null;
      setLoadedUrl(null);
    };
  }, [url]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(container.clientWidth * ratio);
      canvas.height = Math.round(container.clientHeight * ratio);
      canvas.style.width = `${container.clientWidth}px`;
      canvas.style.height = `${container.clientHeight}px`;
      fill();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fill]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const ratio = window.devicePixelRatio || 1;
    const fontFamily = getComputedStyle(canvas).fontFamily || "sans-serif";
    clearStage(ctx, canvas.clientWidth, canvas.clientHeight, ratio);

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    if (imageReady && imageRef.current) {
      drawRaster(ctx, imageRef.current, frame, mode);
    } else {
      drawFrameGeometry(ctx, frame, transform, fontFamily);
    }

    if (overlaysVisible && (mode === "detections" || mode === "change")) {
      drawDetectionOverlays(ctx, detections, {
        mode,
        selectedId,
        transform,
        fontFamily,
        verdictFor,
      });
    }
    ctx.restore();
  }, [detections, frame, imageReady, mode, overlaysVisible, selectedId, transform, verdictFor]);

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, origin: transform };
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setCursor({
      ping: Math.max(0, Math.round((event.clientX - rect.left - transform.x) / transform.scale)),
      across: Math.max(0, Math.round((event.clientY - rect.top - transform.y) / transform.scale)),
    });
    const drag = dragRef.current;
    if (drag) {
      setTransform({
        scale: drag.origin.scale,
        x: drag.origin.x + event.clientX - drag.x,
        y: drag.origin.y + event.clientY - drag.y,
      });
    }
  }

  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const moved = Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y);
    if (moved > 5 || !overlaysVisible) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const hit = hitTest(
      detections,
      (event.clientX - rect.left - transform.x) / transform.scale,
      (event.clientY - rect.top - transform.y) / transform.scale,
    );
    if (hit) onSelect(hit.detection_id);
  }

  function wheel(event: ReactWheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const fitScale = Math.min(rect.width / frame.width_px, rect.height / frame.height_px);
    setTransform((current) =>
      zoomAtPoint(
        current,
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        Math.exp(-event.deltaY * 0.0015),
        fitScale * 0.5,
        8,
      ),
    );
  }

  // Keyboard equivalents, so the viewport is usable without a pointer.
  function keyDown(event: React.KeyboardEvent<HTMLCanvasElement>) {
    const nudge = event.shiftKey ? 120 : 40;
    const map: Record<string, [number, number]> = {
      ArrowLeft: [nudge, 0],
      ArrowRight: [-nudge, 0],
      ArrowUp: [0, nudge],
      ArrowDown: [0, -nudge],
    };
    const delta = map[event.key];
    if (delta) {
      event.preventDefault();
      setTransform((c) => ({ scale: c.scale, x: c.x + delta[0], y: c.y + delta[1] }));
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      fit();
    }
  }

  const rasterMissing = !imageReady;

  return (
    <div className="viewer-shell">
      <div className="sonar-canvas-wrap" ref={containerRef}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label={`Sonar frame ${frame.frame_id}. Drag or use the arrow keys to pan, scroll to zoom, press 0 to fit, click a detection to inspect it.`}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onWheel={wheel}
          onKeyDown={keyDown}
        />

        <div className="viewer-hud">
          <LayerModeTabs mode={mode} onChange={setMode} changeAvailable={changeAvailable} />
          <ViewerActions
            overlaysVisible={overlaysVisible}
            onToggleOverlays={() => setOverlaysVisible((v) => !v)}
            onFit={fit}
            onActualSize={() => setTransform({ scale: 1, x: 24, y: 24 })}
          />
        </div>

        {rasterMissing && (
          <div className="raster-plaque">
            <strong>No imagery for this layer</strong>
            <p>
              The {mode === "enhanced" ? "enhanced" : "raw"} raster is not available for
              this frame. Port, starboard and nadir are drawn from the frame geometry on
              the contract, and detection boxes use contract coordinates. Nothing here is
              a picture of the seabed.
            </p>
          </div>
        )}

        <p className="range-compass" aria-label="Direction of increasing range">
          <span>PORT</span>
          <i>range from nadir</i>
          <span>STARBOARD</span>
        </p>

        {detections.length === 0 && (
          <p className="no-detections-note">No detections loaded for this frame</p>
        )}
      </div>

      <div className="viewer-status">
        <span>{frame.frame_id}</span>
        <span>{(transform.scale * 100).toFixed(0)}%</span>
        <span>
          {cursor
            ? `ping ${cursor.ping.toLocaleString()}, across ${cursor.across} px`
            : "cursor unset"}
        </span>
        <span>{frame.geometry.channel}</span>
        <span>{LEVEL_LABELS[frame.geometry.level]}</span>
      </div>
    </div>
  );
}
