import { describe, expect, it } from "vitest";
import {
  dockPosition,
  monitorDistanceSquared,
  nearestDockPlacement,
  rectCenter,
} from "./desktop-host-geometry";

describe("desktop host geometry", () => {
  const workArea = { x: -1600, y: 30, width: 1600, height: 900 };
  const size = { width: 320, height: 124 };

  it("places a native window against all four physical work-area edges", () => {
    expect(dockPosition(workArea, "top", 0.5, size)).toEqual({ x: -960, y: 30 });
    expect(dockPosition(workArea, "right", 0.5, size)).toEqual({ x: -320, y: 418 });
    expect(dockPosition(workArea, "bottom", 0.5, size)).toEqual({ x: -960, y: 806 });
    expect(dockPosition(workArea, "left", 0.5, size)).toEqual({ x: -1600, y: 418 });
  });

  it("snaps the current outer rect to the nearest edge and recenters it", () => {
    expect(nearestDockPlacement(workArea, { x: -1500, y: 39 }, size)).toEqual({
      edge: "top",
      offset: 0.5,
      position: { x: -960, y: 30 },
    });
    expect(nearestDockPlacement(workArea, { x: -318, y: 510 }, size)).toEqual({
      edge: "right",
      offset: 0.5,
      position: { x: -320, y: 418 },
    });
  });

  it("ignores legacy offsets and always centers the visible window", () => {
    expect(dockPosition(workArea, "bottom", 0, size)).toEqual({ x: -960, y: 806 });
    expect(dockPosition(workArea, "right", 1, size)).toEqual({ x: -320, y: 418 });
  });

  it("chooses the closest display when the window center is between displays", () => {
    expect(monitorDistanceSquared({ x: -4, y: 20 }, { x: 0, y: 0, width: 100, height: 100 })).toBe(16);
    expect(rectCenter({ x: -10, y: 20 }, { width: 20, height: 40 })).toEqual({ x: 0, y: 40 });
  });
});
