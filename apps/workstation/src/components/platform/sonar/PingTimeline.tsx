"use client";

import type { Detection, SonarFrame } from "@/lib/types";

/**
 * Along-track frame selector.
 *
 * Detection ticks are derived from the detections the caller has actually
 * loaded. A frame with no loaded detections shows no ticks rather than an
 * assumed marker.
 */
export function PingTimeline({
  frames,
  frameIndex,
  detections,
  onSelect,
  statusLabel,
  actionSlot,
}: {
  frames: SonarFrame[];
  frameIndex: number;
  detections: Detection[];
  onSelect: (index: number) => void;
  statusLabel: string;
  actionSlot?: React.ReactNode;
}) {
  const byFrame = new Map<string, { known: boolean; unknown: boolean }>();
  detections.forEach((detection) => {
    const entry = byFrame.get(detection.frame_id) ?? { known: false, unknown: false };
    if (detection.kind === "UNKNOWN") entry.unknown = true;
    else entry.known = true;
    byFrame.set(detection.frame_id, entry);
  });

  return (
    <div className="timeline">
      <div className="timeline-meta">
        Along track
        <strong>{statusLabel}</strong>
        {actionSlot}
      </div>
      <div className="ping-track" role="tablist" aria-label="Frames along track">
        {frames.map((frame, index) => {
          const ticks = byFrame.get(frame.frame_id);
          return (
            <button
              key={frame.frame_id}
              type="button"
              role="tab"
              className="ping-cell"
              aria-selected={index === frameIndex}
              aria-current={index === frameIndex}
              aria-label={`Open frame ${frame.index}`}
              onClick={() => onSelect(index)}
            >
              {ticks?.known && <i className="known" title="Known detection on this frame" />}
              {ticks?.unknown && <i className="unknown" title="Unknown anomaly candidate on this frame" />}
              {frame.index}
            </button>
          );
        })}
      </div>
    </div>
  );
}
