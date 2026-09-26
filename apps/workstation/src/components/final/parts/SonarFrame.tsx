"use client";

import { useEffect, useRef, useState } from "react";
import { boxRect, canonicalClass, classLabel, isUnknown } from "../runtime/select";
import { UNAVAILABLE } from "../runtime/strings";
import type { RuntimeFinding, RuntimeFrame } from "../runtime/types";

export type Layer = "raw" | "enhanced" | "detections" | "change";

/**
 * §5.7 centre viewer. The raster and the detection boxes share one plate whose
 * rectangle is derived from the frame's real pixel dimensions, so the fractional
 * geometry from the API stays locked to the acoustic return at any pane width.
 * Raw is unfiltered; Enhanced and Change apply the frozen filters via CSS.
 */
export function SonarFrame({
  finding,
  frame,
  src,
  layer,
  boxes,
  showLabel = true,
  overlayFindings,
}: {
  finding: RuntimeFinding | null;
  frame: RuntimeFrame | undefined;
  src: string | null;
  layer: Layer;
  boxes: boolean;
  showLabel?: boolean;
  overlayFindings?: RuntimeFinding[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const [plate, setPlate] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  /* Derived rather than reset in an effect: a new src is not broken until
   * its own load fails. */
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const broken = src !== null && brokenSrc === src;

  const imageWidth = frame?.width_px ?? finding?.pixel_dimensions?.[0] ?? 1120;
  const imageHeight = frame?.height_px ?? finding?.pixel_dimensions?.[1] ?? 630;

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      if (!width || !height || !imageWidth || !imageHeight) return;
      const scale = Math.min(width / imageWidth, height / imageHeight);
      const w = imageWidth * scale;
      const h = imageHeight * scale;
      setPlate({ left: (width - w) / 2, top: (height - h) / 2, width: w, height: h });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [imageWidth, imageHeight]);

  /* §5.7 states: change layer with no previous pass draws no boxes and says so. */
  const noBaseline = layer === "change";
  const drawn = boxes && !noBaseline && !broken && src
    ? (overlayFindings ?? (finding ? [finding] : []))
    : [];

  return (
    <div className="sd-frame" ref={host}>
      {src && !broken ? (
        <div
          className="sd-frame-plate"
          data-layer={layer}
          style={plate ? { left: plate.left, top: plate.top, width: plate.width, height: plate.height } : { inset: 0 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- the raster is
              streamed from the local runtime API at an arbitrary size and must
              fill the measured plate exactly for the fractional detection
              geometry to land on the acoustic return. */}
          <img
            src={src}
            alt={
              finding
                ? `Side-scan sonar window, ${classLabel(finding)}`
                : "Side-scan sonar window"
            }
            onError={() => setBrokenSrc(src)}
          />
          {drawn.map((item) => {
            const unknown = isUnknown(item);
            return (
              <div
                key={item.detection_id}
                className="sd-box"
                data-kind={unknown ? "unknown" : "known"}
                style={boxRect(item)}
              >
                {showLabel ? (
                  <b>{classLabel(item)}</b>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="sd-frame-missing">{UNAVAILABLE.windowTitle}</div>
      )}
      {noBaseline && src && !broken ? (
        <div className="sd-frame-missing" style={{ alignItems: "start", paddingTop: 20 }}>
          {UNAVAILABLE.changeLayer}
        </div>
      ) : null}
    </div>
  );
}

export function layerClassOf(finding: RuntimeFinding) {
  return canonicalClass(finding);
}
