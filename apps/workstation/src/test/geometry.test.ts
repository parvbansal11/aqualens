import { describe, expect, it } from "vitest";
import { bboxToViewport, fillHeightTransform, fitTransform, zoomAtPoint } from "@/lib/geometry";

describe("sonar geometry", () => {
  it("fits an image without distorting bbox coordinates", () => {
    const transform = fitTransform(1000, 500, 5000, 500);
    expect(transform).toEqual({ scale: 0.2, x: 0, y: 200 });
    expect(bboxToViewport([1000, 100, 500, 50], transform)).toEqual([
      200, 220, 100, 10,
    ]);
  });

  it("fills viewport height so wide frames are not collapsed to a ribbon", () => {
    expect(fillHeightTransform(500, 500)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("keeps the image point under the cursor stable while zooming", () => {
    const before = { scale: 0.2, x: 0, y: 200 };
    const after = zoomAtPoint(before, { x: 400, y: 250 }, 2, 0.1, 8);
    const imagePointBefore = {
      x: (400 - before.x) / before.scale,
      y: (250 - before.y) / before.scale,
    };
    const imagePointAfter = {
      x: (400 - after.x) / after.scale,
      y: (250 - after.y) / after.scale,
    };
    expect(imagePointAfter).toEqual(imagePointBefore);
  });
});
