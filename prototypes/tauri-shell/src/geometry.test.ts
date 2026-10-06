import { describe, expect, it } from "vitest";
import { computeDockGeometry, resolveMonitor, type MonitorCandidate } from "./geometry";

const leftWorkArea = { x: -1920, y: 0, width: 1920, height: 1040 };

describe("computeDockGeometry", () => {
  it("places a scaled window at the top using a physical work area and negative monitor origin", () => {
    const result = computeDockGeometry(leftWorkArea, "top", 0.5, { width: 360, height: 300 }, 1.5);

    expect(result).toEqual({
      position: { x: -1230, y: 0 },
      size: { width: 540, height: 450 },
      boundsSize: { width: 540, height: 450 },
      ratio: 0.5,
      sizeClamped: false,
    });
  });

  it("positions all remaining edges within the work area at ratio endpoints", () => {
    const area = { x: -1600, y: -120, width: 1600, height: 900 };
    const size = { width: 400, height: 200 };

    expect(computeDockGeometry(area, "right", 0, size, 1).position).toEqual({ x: -400, y: -120 });
    expect(computeDockGeometry(area, "bottom", 1, size, 1).position).toEqual({ x: -400, y: 580 });
    expect(computeDockGeometry(area, "left", 0.25, size, 1).position).toEqual({ x: -1600, y: 55 });
  });

  it("clamps the along-edge ratio and prevents a too-large window from escaping the work area", () => {
    const area = { x: -80, y: 30, width: 300, height: 160 };
    const result = computeDockGeometry(area, "bottom", 2, { width: 500, height: 400 }, 1.5);

    expect(result).toEqual({
      position: { x: -80, y: 30 },
      size: { width: 300, height: 160 },
      boundsSize: { width: 300, height: 160 },
      ratio: 1,
      sizeClamped: true,
    });
  });

  it("uses the center when a ratio is not finite", () => {
    const result = computeDockGeometry({ x: 0, y: 0, width: 800, height: 600 }, "top", Number.NaN, { width: 200, height: 100 }, 1);
    expect(result.position).toEqual({ x: 300, y: 0 });
    expect(result.ratio).toBe(0.5);
  });

  it("aligns native outer bounds while returning the requested client size", () => {
    const result = computeDockGeometry(
      { x: 0, y: 0, width: 1000, height: 700 },
      "right",
      0,
      { width: 300, height: 200 },
      1,
      { width: 22, height: 13 },
    );

    expect(result.position).toEqual({ x: 678, y: 0 });
    expect(result.size).toEqual({ width: 300, height: 200 });
    expect(result.boundsSize).toEqual({ width: 322, height: 213 });
  });

  it("reserves native margins when the work area is smaller than the requested window", () => {
    const result = computeDockGeometry(
      { x: -80, y: 30, width: 300, height: 160 },
      "bottom",
      0.5,
      { width: 500, height: 400 },
      1,
      { width: 22, height: 13 },
    );

    expect(result.size).toEqual({ width: 278, height: 147 });
    expect(result.boundsSize).toEqual({ width: 300, height: 160 });
    expect(result.position).toEqual({ x: -80, y: 30 });
  });

  it("rejects an invalid scale factor and invalid logical dimensions", () => {
    expect(() => computeDockGeometry(leftWorkArea, "top", 0.5, { width: 10, height: 10 }, 0)).toThrow(RangeError);
    expect(() => computeDockGeometry(leftWorkArea, "top", 0.5, { width: -10, height: 10 }, 1)).toThrow(RangeError);
  });
});

describe("resolveMonitor", () => {
  const monitors: MonitorCandidate<string>[] = [
    { id: "left", primary: false, value: "left-display" },
    { id: "main", primary: true, value: "main-display" },
  ];

  it("uses the requested display while it is connected", () => {
    expect(resolveMonitor("left", monitors)).toEqual({ monitor: monitors[0], usedFallback: false });
  });

  it("falls back to the primary display after the requested one disappears", () => {
    const remaining = [monitors[1]];
    expect(resolveMonitor("left", remaining)).toEqual({ monitor: monitors[1], usedFallback: true });
  });

  it("uses the primary display when no preference has been saved", () => {
    expect(resolveMonitor(null, monitors)).toEqual({ monitor: monitors[1], usedFallback: false });
  });

  it("returns no target when the system reports no displays", () => {
    expect(resolveMonitor("left", [])).toEqual({ monitor: null, usedFallback: false });
  });
});
