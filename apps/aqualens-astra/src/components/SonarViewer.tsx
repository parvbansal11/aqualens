import { useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import type { Frame, Observation } from "../lib/runtime/types";
export function SonarViewer({
  frame,
  observation,
  mode,
  demo,
}: {
  frame: Frame;
  observation?: Observation;
  mode: string;
  demo: boolean;
}) {
  const [zoom, setZoom] = useState(1),
    [position, setPosition] = useState({ x: 0, y: 0 }),
    [failed, setFailed] = useState(false);
  const box = observation?.box;
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.min(
        entry.contentRect.width,
        ((entry.contentRect.height - 72) * frame.width) / frame.height,
      );
      setSize({ width, height: (width * frame.height) / frame.width });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [frame.width, frame.height]);
  return (
    <div
      ref={viewport}
      className={`sonar-viewer mode-${mode}`}
      role="region"
      tabIndex={0}
      aria-label="Sonar viewport. Plus and minus zoom, arrow keys pan when zoomed, zero resets."
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (
          [
            "+",
            "=",
            "-",
            "0",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
          ].includes(e.key)
        )
          e.preventDefault();
        if (e.key === "+" || e.key === "=")
          setZoom((z) => Math.min(3, z + 0.25));
        if (e.key === "-") {
          setZoom((z) => Math.max(1, z - 0.25));
          if (zoom <= 1.25) setPosition({ x: 0, y: 0 });
        }
        if (e.key === "0") {
          setZoom(1);
          setPosition({ x: 0, y: 0 });
        }
        if (zoom > 1)
          setPosition((p) => ({
            x: Math.max(
              -350,
              Math.min(
                350,
                p.x +
                  (e.key === "ArrowLeft"
                    ? 30
                    : e.key === "ArrowRight"
                      ? -30
                      : 0),
              ),
            ),
            y: Math.max(
              -220,
              Math.min(
                220,
                p.y +
                  (e.key === "ArrowUp" ? 30 : e.key === "ArrowDown" ? -30 : 0),
              ),
            ),
          }));
      }}
      onPointerDown={(e) => {
        if (zoom > 1) {
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }}
      onPointerMove={(e) => {
        if (e.buttons && zoom > 1)
          setPosition((p) => ({
            x: Math.max(-350, Math.min(350, p.x + e.movementX)),
            y: Math.max(-220, Math.min(220, p.y + e.movementY)),
          }));
      }}
    >
      <div className="sonar-corner sonar-top-left">
        <span className="sonar-indicator" />
        {mode === "raw"
          ? "RAW SONAR"
          : mode === "enhanced"
            ? "DISPLAY CONTRAST"
            : "OBSERVATION OVERLAY"}
      </div>
      <span className="sonar-corner sonar-top-right mono">{frame.id}</span>
      <div
        className="sonar-stage"
        style={{
          transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
          width: size.width || "100%",
          height: size.height || "auto",
        }}
      >
        {failed ? (
          <div className="raster-failure">
            The source raster could not be loaded.
          </div>
        ) : (
          <img
            src={frame.image}
            alt={`Source sonar raster ${frame.name}`}
            draggable={false}
            onError={() => setFailed(true)}
          />
        )}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="sonar-overlay"
          aria-label={
            mode === "detections" && box
              ? demo
                ? "Illustrative observation boundary"
                : "Recorded observation boundary"
              : undefined
          }
        >
          {mode === "detections" && box && (
            <rect
              x={box[0] * 100}
              y={box[1] * 100}
              width={(box[2] - box[0]) * 100}
              height={(box[3] - box[1]) * 100}
            />
          )}
        </svg>
        {mode === "detections" && box && (
          <span
            className="bbox-label"
            style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%` }}
          >
            {demo ? "ILLUSTRATIVE OBSERVATION" : observation?.id}
          </span>
        )}
      </div>
      <div className="sonar-corner sonar-bottom-left">
        <span className="mono">
          {frame.width} × {frame.height} PX
        </span>
        <span>
          {mode === "enhanced"
            ? "Display adjustment only · original pixels preserved"
            : demo
              ? "REAL SONAR / ILLUSTRATIVE CONTEXT"
              : "SOURCE RASTER"}
        </span>
      </div>
      <div className="viewer-controls">
        <button
          aria-label="Zoom out sonar"
          onClick={() => {
            setZoom((z) => Math.max(1, z - 0.25));
            if (zoom <= 1.25) setPosition({ x: 0, y: 0 });
          }}
          disabled={zoom === 1}
        >
          <Minus size={17} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="Zoom in sonar"
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
          disabled={zoom === 3}
        >
          <Plus size={17} />
        </button>
        <button
          aria-label="Reset sonar view"
          onClick={() => {
            setZoom(1);
            setPosition({ x: 0, y: 0 });
          }}
        >
          <RotateCcw size={16} />
        </button>
        <button
          aria-label="Expand sonar view"
          onClick={(e) => {
            const viewer = e.currentTarget.closest(".sonar-viewer");
            if (document.fullscreenElement)
              void document.exitFullscreen().catch(() => {});
            else void viewer?.requestFullscreen?.().catch(() => {});
          }}
        >
          <Maximize2 size={16} />
        </button>
      </div>
    </div>
  );
}
