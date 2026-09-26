import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DetectionInspector } from "@/components/platform/DetectionInspector";
import { ProvenanceBadge } from "@/components/platform/ProvenanceBadge";
import { comparisonChanges, detections } from "@/test/fixtures/data";
import { parseDetection } from "@/lib/api-client";

describe("frozen contract invariants", () => {
  it("parses the canonical known detection", () => {
    expect(parseDetection(detections[0]).detection_id).toBe("det_known_fixture");
  });

  it("rejects class confidence on UNKNOWN detections", () => {
    const invalid = structuredClone(detections[1]);
    invalid.class_confidence = 0.9;
    expect(() => parseDetection(invalid)).toThrow(
      "UNKNOWN detections cannot carry class confidence",
    );
  });

  it("never renders class confidence for an UNKNOWN candidate", () => {
    render(<DetectionInspector detection={detections[1]} priority={null} reviews={[]} submitting={null} message={null} reviewer="test_operator" onSubmit={() => {}} />);
    expect(
      screen.getByText("Unknown anomaly candidate requiring review"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Class confidence")).not.toBeInTheDocument();
    expect(
      screen.getByText("No class confidence — open-world candidate"),
    ).toBeInTheDocument();
  });

  it("renders every provenance category distinctly", () => {
    const values = [
      "MODEL_DERIVED",
      "HEURISTIC_DERIVED",
      "OPERATOR_PROVIDED",
      "DEMO_METADATA",
    ] as const;
    render(
      <>
        {values.map((value) => (
          <ProvenanceBadge key={value} value={value} />
        ))}
      </>,
    );
    values.forEach((value) => {
      expect(screen.getAllByText(value).length).toBeGreaterThan(0);
    });
  });

  it("distinguishes REMOVED from NOT_SURVEYED by coverage", () => {
    const removed = comparisonChanges.find((item) => item.status === "REMOVED");
    const notSurveyed = comparisonChanges.find(
      (item) => item.status === "NOT_SURVEYED",
    );
    expect(removed?.inside_new_coverage).toBe(true);
    expect(notSurveyed?.inside_new_coverage).toBe(false);
  });
});
