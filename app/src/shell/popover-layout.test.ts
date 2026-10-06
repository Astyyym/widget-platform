import { describe, expect, it } from "vitest";
import { shellPopoverPosition } from "./popover-layout";
import type { ShellEdge, ShellRect } from "./shell-layout";
const stage = { width: 640, height: 640 };
const size = { width: 286, height: 99 };
const button: ShellRect = { left: 280, top: 15, width: 50, height: 50 };
describe("popover space and dock boundary", () => {
  it.each([
    ["top", { left: 30, top: 0, width: 580, height: 80 }, { x: 162, y: 92 }],
    ["bottom", { left: 30, top: 560, width: 580, height: 80 }, { x: 162, y: 449 }],
    ["left", { left: 0, top: 30, width: 80, height: 580 }, { x: 92, y: 12 }],
    ["right", { left: 560, top: 30, width: 80, height: 580 }, { x: 262, y: 12 }],
  ] as const)("anchors %s previews outside the entire dock", (edge, dock, expected) => {
    expect(shellPopoverPosition(edge, stage, dock, button, size)).toEqual(expected);
  });
  it("does not clamp a preview back onto the dock in the compact first viewport", () => {
    expect(shellPopoverPosition("top", { width: 640, height: 124 },
      { left: 30, top: 0, width: 580, height: 80 }, button, size)).toBeNull();
  });
  it("uses actual tall preview height and refuses truly insufficient space", () => {
    const dock = { left: 30, top: 0, width: 580, height: 232 };
    expect(shellPopoverPosition("top", { width: 640, height: 600 }, dock, button, { width: 286, height: 260 })).toEqual({ x: 162, y: 244 });
    expect(shellPopoverPosition("top", { width: 640, height: 400 }, dock, button, { width: 286, height: 260 })).toBeNull();
  });
  it.each(["top", "bottom", "left", "right"] as ShellEdge[])("keeps the orthogonal axis inside the %s viewport", (edge) => {
    const dock = edge === "top" ? { left: 0, top: 0, width: 640, height: 80 }
      : edge === "bottom" ? { left: 0, top: 560, width: 640, height: 80 }
      : edge === "left" ? { left: 0, top: 0, width: 80, height: 640 }
      : { left: 560, top: 0, width: 80, height: 640 };
    const position = shellPopoverPosition(edge, stage, dock, { left: 610, top: 610, width: 30, height: 30 }, size)!;
    expect(position.x).toBeGreaterThanOrEqual(12);
    expect(position.y).toBeGreaterThanOrEqual(12);
    expect(position.x + size.width).toBeLessThanOrEqual(stage.width - 12);
    expect(position.y + size.height).toBeLessThanOrEqual(stage.height - 12);
  });
});
