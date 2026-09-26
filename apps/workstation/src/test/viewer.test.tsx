import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SonarViewport } from "@/components/platform/sonar/SonarViewport";
import { detections, frames } from "@/test/fixtures/data";

describe("SonarViewport", () => {
  it("switches modes without clearing the selected detection", () => {
    const onSelect = vi.fn();
    render(
      <SonarViewport
        frame={frames[7]}
        detections={detections}
        selectedId="det_known_fixture"
        onSelect={onSelect}
        rasterUrl={() => null}
      />,
    );
    const change = screen.getByRole("tab", { name: "CHANGE" });
    fireEvent.click(change);
    expect(change).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "DETECTION" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});
