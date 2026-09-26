"use client";

import type { LayerMode } from "@/lib/types";
import { LAYER_LABELS } from "@/lib/view/labels";

const MODES: LayerMode[] = ["raw", "enhanced", "detections", "change"];

export function LayerModeTabs({
  mode,
  onChange,
  /** CHANGE is meaningless without a comparison, so the caller can disable it. */
  changeAvailable = true,
}: {
  mode: LayerMode;
  onChange: (mode: LayerMode) => void;
  changeAvailable?: boolean;
}) {
  return (
    <div className="layer-tabs" role="tablist" aria-label="Sonar layer">
      {MODES.map((item) => (
        <button
          key={item}
          type="button"
          role="tab"
          aria-selected={mode === item}
          disabled={item === "change" && !changeAvailable}
          title={
            item === "change" && !changeAvailable
              ? "No comparison has been run for this survey pair."
              : undefined
          }
          onClick={() => onChange(item)}
        >
          {LAYER_LABELS[item]}
        </button>
      ))}
    </div>
  );
}
