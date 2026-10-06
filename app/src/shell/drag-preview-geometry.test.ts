import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DRAG_PREVIEW_EDGES, dragPreviewEdgeAtPoint, dragPreviewTargetRects } from "./drag-preview-geometry";

const dimensions = {
  top: { longSide: 580, thickness: 80 }, bottom: { longSide: 580, thickness: 80 },
  left: { longSide: 460, thickness: 80 }, right: { longSide: 460, thickness: 80 },
};
describe("physical preview geometry", () => {
  it.each([1, 1.25, 1.5, 2])("shares exact render and hit rectangles at scale %s on a negative-coordinate work area", (scale) => {
    const area = { x: -1920, y: -120, width: 1920, height: 1040 };
    const targets = dragPreviewTargetRects(area, scale, dimensions);
    for (const edge of DRAG_PREVIEW_EDGES) {
      const rect = targets[edge];
      expect(rect.x).toBeGreaterThanOrEqual(area.x);
      expect(rect.y).toBeGreaterThanOrEqual(area.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(area.x + area.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(area.y + area.height);
      expect(dragPreviewEdgeAtPoint(targets, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })).toBe(edge);
    }
    expect(targets.top.y).toBe(area.y);
    expect(targets.bottom.y + targets.bottom.height).toBe(area.y + area.height);
    expect(targets.left.x).toBe(area.x);
    expect(targets.right.x + targets.right.width).toBe(area.x + area.width);
    expect(targets.top.width).toBe(Math.round(580 * scale));
    expect(targets.left.height).toBe(Math.round(460 * scale));
    expect(dragPreviewEdgeAtPoint(targets, { x: -960, y: 400 })).toBeNull();
    expect(dragPreviewEdgeAtPoint(targets, { x: area.x - 1, y: 400 })).toBeNull();
    expect(dragPreviewEdgeAtPoint(targets, { x: area.x + area.width, y: 400 })).toBeNull();
  });

  it("does not extend target windows beyond a small work area", () => {
    const targets = dragPreviewTargetRects({ x: 0, y: 0, width: 360, height: 280 }, 2, dimensions);
    for (const rect of Object.values(targets)) {
      expect(rect.width).toBeLessThanOrEqual(360);
      expect(rect.height).toBeLessThanOrEqual(280);
    }
  });

  it("uses a thin dashed outline without an external shadow", () => {
    const css = readFileSync(new URL("./drag-preview-window.css", import.meta.url), "utf8");
    expect(css).toMatch(/border:\s*2px dashed/);
    expect(css).not.toMatch(/box-shadow:\s*(?!none)[^;}]+/);
  });
});
