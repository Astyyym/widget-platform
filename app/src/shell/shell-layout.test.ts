import { describe, expect, it } from "vitest";
import { DEFAULT_SHELL_MODULES } from "./ShellFrame";
import {
  calculateShellLayout,
  ICON_SIZE_MAX,
  ICON_SIZE_MIN,
  type ShellEdge,
  type ShellRingMode,
  resolveShellDrop,
  shellDragPreviewPosition,
} from "./shell-layout";

const edges: readonly ShellEdge[] = ["top", "right", "bottom", "left"];
const ringModes: readonly ShellRingMode[] = ["off", "inner", "outer"];

describe("approved shell dimensions", () => {
  it("does not reserve the removed trailing opacity slot in a compact full row", () => {
    const layout = calculateShellLayout({ stageWidth: 1000, stageHeight: 900, edge: "top", itemCount: 9, iconSize: 20, ringMode: "off", longSide: 96, thickness: 40 });
    expect(layout.minimumLongSide).toBe(9 * layout.hitSize + 8 * 4 + 2 * (layout.gridPadding ?? 8) + 2);
    expect(layout.itemsPerLine).toBe(9);
  });
  it.each(edges)("keeps 20px circles and smaller click areas inside a compact %s card", (edge) => {
    const layout = calculateShellLayout({ stageWidth: 1000, stageHeight: 900, edge, itemCount: 1, iconSize: 20, ringMode: "off", longSide: 96, thickness: 40 });
    expect(layout.iconSize).toBe(20);
    expect(layout.hitSize).toBe(28);
    expect(layout.longSide).toBe(96);
    expect(layout.thickness).toBe(40);
  });
  it("honors a requested two-row layout instead of spreading everything on one line", () => {
    const layout = calculateShellLayout({ stageWidth: 1000, stageHeight: 800, edge: "top", itemCount: 9, iconSize: 46, ringMode: "off", rows: 2 });
    expect(layout.lineCount).toBe(2);
    expect(layout.itemsPerLine).toBe(5);
    expect(layout.thickness).toBeGreaterThanOrEqual(layout.minimumThickness);
  });
  it("keeps four requested rows even when ceil division would otherwise produce only three", () => {
    const layout = calculateShellLayout({ stageWidth: 1000, stageHeight: 800, edge: "top", itemCount: 9, iconSize: 46, ringMode: "off", rows: 4 });
    expect(layout.lineCount).toBe(4);
  });
  it("keeps one long-side and thickness preference across all four edges", () => {
    for (const edge of edges) {
      const layout = calculateShellLayout({
        stageWidth: 864,
        stageHeight: 765,
        edge,
        itemCount: 8,
        iconSize: 46,
        ringMode: "inner",
        longSide: 580,
        thickness: 90,
      });

      expect(layout.longSide).toBe(580);
      expect(layout.thickness).toBe(90);
      expect(layout.itemsPerLine).toBe(8);
      expect(layout.lineCount).toBe(1);
    }
  });

  it("preserves icon diameters and wraps the eight-icon layout in a narrow stage", () => {
    for (const edge of edges) {
      for (const iconSize of [ICON_SIZE_MIN, ICON_SIZE_MAX]) {
        for (const ringMode of ringModes) {
          const layout = calculateShellLayout({
            stageWidth: 334,
            stageHeight: 628,
            edge,
            itemCount: 8,
            iconSize,
            ringMode,
            longSide: 580,
            thickness: 90,
          });

          expect(layout.iconSize).toBe(iconSize);
          expect(layout.longSide).toBeLessThanOrEqual(
            edge === "top" || edge === "bottom" ? 334 : 628,
          );
          expect(layout.itemsPerLine).toBeGreaterThanOrEqual(1);
          expect(layout.itemsPerLine).toBeLessThanOrEqual(8);
          expect(layout.lineCount).toBe(Math.ceil(8 / layout.itemsPerLine));
          expect(layout.thickness).toBeGreaterThanOrEqual(
            layout.minimumThickness,
          );
        }
      }
    }
  });

  it("matches the approved 390 by 760 reference stage for maximum outer rings", () => {
    const horizontal = calculateShellLayout({
      stageWidth: 334,
      stageHeight: 628,
      edge: "top",
      itemCount: 8,
      iconSize: ICON_SIZE_MAX,
      ringMode: "outer",
      longSide: 580,
      thickness: 90,
    });
    const vertical = calculateShellLayout({
      stageWidth: 334,
      stageHeight: 628,
      edge: "right",
      itemCount: 8,
      iconSize: ICON_SIZE_MAX,
      ringMode: "outer",
      longSide: 580,
      thickness: 90,
    });

    expect(horizontal.hitSize).toBe(66);
    expect(horizontal.longSide).toBe(198);
    expect(horizontal.itemsPerLine).toBe(2);
    expect(horizontal.lineCount).toBe(4);
    expect(horizontal.thickness).toBe(294);
    expect(vertical.longSide).toBe(492);
    expect(vertical.itemsPerLine).toBe(6);
    expect(vertical.lineCount).toBe(2);
    expect(vertical.thickness).toBe(154);
  });

  it("does not introduce sample system readings into the product defaults", () => {
    expect(DEFAULT_SHELL_MODULES).toHaveLength(8);
    expect(DEFAULT_SHELL_MODULES.every((module) => module.progress === undefined))
      .toBe(true);
    expect(DEFAULT_SHELL_MODULES.map(({ id }) => id)).toEqual([
      "todo",
      "focus",
      "cpu",
      "gpu",

      "memory",
      "media",
      "codex",
      "weather",
    ]);
  });
});

describe("dock drag target resolution", () => {
  const stage = { width: 864, height: 765 };
  const targets = [
    { edge: "top" as const, rect: { left: 245, top: 2, width: 374, height: 112 } },
    { edge: "right" as const, rect: { left: 750, top: 188, width: 112, height: 389 } },
    { edge: "bottom" as const, rect: { left: 245, top: 651, width: 374, height: 112 } },
    { edge: "left" as const, rect: { left: 2, top: 188, width: 112, height: 389 } },
  ];

  it("centers the dock when released inside each dotted edge target", () => {
    const points = [
      { x: 432, y: 48 },
      { x: 806, y: 382 },
      { x: 432, y: 709 },
      { x: 58, y: 382 },
    ];

    points.forEach((point, index) => {
      expect(resolveShellDrop(point, stage, targets, 624)).toEqual({
        edge: edges[index],
        offset: 0.5,
        centered: true,
      });
    });
  });

  it("returns no target outside the four centered drop zones", () => {
    expect(resolveShellDrop({ x: 200, y: 290 }, stage, targets, 624)).toBeNull();
    expect(resolveShellDrop({ x: 432, y: 220 }, stage, targets, 624)).toBeNull();
    expect(resolveShellDrop({ x: 700, y: 220 }, stage, targets, 624)).toBeNull();
  });

  it("uses the center when the card occupies the whole edge", () => {
    expect(resolveShellDrop({ x: 40, y: 0 }, { width: 80, height: 60 }, [], 120)).toBeNull();
  });

  it("centers a card during target preview", () => {
    expect(
      shellDragPreviewPosition(
        { edge: "top", offset: 0.5, centered: true },
        { x: 450, y: 48 },
        { width: 864, height: 765 },
        { width: 580, height: 90 },
        { x: 45, y: 0 },
      ),
    ).toEqual({ x: 142, y: 0 });
  });
});
