"use client";

import { Eye, EyeOff, Maximize2, ScanLine } from "lucide-react";

export function ViewerActions({
  overlaysVisible,
  onToggleOverlays,
  onFit,
  onActualSize,
}: {
  overlaysVisible: boolean;
  onToggleOverlays: () => void;
  onFit: () => void;
  onActualSize: () => void;
}) {
  return (
    <div className="viewer-actions">
      <button
        type="button"
        aria-pressed={overlaysVisible}
        onClick={onToggleOverlays}
        title="Toggle detection overlays"
      >
        {overlaysVisible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
        Overlays
      </button>
      <button type="button" onClick={onFit} title="Fit the frame to the viewport">
        <Maximize2 size={14} aria-hidden="true" />
        Fit
      </button>
      <button type="button" onClick={onActualSize} title="One image pixel per screen pixel">
        <ScanLine size={14} aria-hidden="true" />
        1:1
      </button>
    </div>
  );
}
