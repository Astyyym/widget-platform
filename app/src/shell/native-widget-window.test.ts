import { describe, expect, it, vi } from "vitest";
import { getCurrentWindow, type Monitor } from "@tauri-apps/api/window";
import { positionWidgetWindow, widgetWindowSize } from "./native-widget-window";

vi.mock("@tauri-apps/api/window", async (original) => ({
  ...await original<typeof import("@tauri-apps/api/window")>(),
  getCurrentWindow: vi.fn(),
}));

describe("native widget window sizing", () => {
  it.each(["top", "bottom"] as const)("reserves the full CSS panel gap and inset at %s without self-shrinking", (edge) => {
    const dimensions = { longSide: 580, thickness: 80, panelSize: { width: 380, height: 420 } };
    const size = widgetWindowSize(edge, "panel", dimensions);
    expect(size.height - dimensions.thickness - 36).toBeGreaterThanOrEqual(dimensions.panelSize.height);
  });
  it.each(["top", "bottom", "left", "right"] as const)("reserves %s space for the full multi-row dock and measured preview", (edge) => {
    const dimensions = { longSide: 580, thickness: 232, popoverSize: { width: 286, height: 260 } };
    const size = widgetWindowSize(edge, "popover", dimensions);
    if (edge === "top" || edge === "bottom") expect(size.height).toBeGreaterThanOrEqual(516);
    else expect(size.width).toBeGreaterThanOrEqual(542);
    expect(size.width).toBeGreaterThanOrEqual(dimensions.popoverSize.width + 24);
    expect(size.height).toBeGreaterThanOrEqual(dimensions.popoverSize.height + 24);
  });

  it("limits popover expansion to the selected monitor work area in logical pixels", async () => {
    const setSize = vi.fn(async () => undefined);
    vi.mocked(getCurrentWindow).mockReturnValue({ setSize,
      outerSize: async () => ({ width: 800, height: 500 }), setPosition: async () => undefined,
    } as unknown as ReturnType<typeof getCurrentWindow>);
    const monitor = { position: { x: 0, y: 0 }, size: { width: 800, height: 600 },
      workArea: { position: { x: 0, y: 0 }, size: { width: 800, height: 500 } }, scaleFactor: 2,
    } as Monitor;
    await positionWidgetWindow("top", 0.5, "popover", { longSide: 580, thickness: 232, popoverSize: { width: 286, height: 260 } }, monitor);
    expect(setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 400, height: 250 }));
  });
  it("keeps compact bounds to the dock plus its real outside controls", () => {
    expect(widgetWindowSize("top", "compact")).toEqual({ width: 304, height: 108 });
    expect(widgetWindowSize("bottom", "compact")).toEqual({ width: 304, height: 108 });
    expect(widgetWindowSize("left", "compact")).toEqual({ width: 108, height: 304 });
    expect(widgetWindowSize("right", "compact")).toEqual({ width: 108, height: 304 });
  });

  it("maps configured long side and thickness to horizontal and vertical windows", () => {
    const dimensions = { longSide: 420, thickness: 96 };
    expect(widgetWindowSize("top", "compact", dimensions)).toEqual({ width: 464, height: 124 });
    expect(widgetWindowSize("right", "compact", dimensions)).toEqual({ width: 124, height: 464 });
  });

  it("uses the measured activity panel instead of a fixed large canvas", () => {
    const dimensions = { longSide: 720, thickness: 240, panelSize: { width: 380, height: 300 } };
    expect(widgetWindowSize("top", "panel", dimensions)).toEqual({ width: 764, height: 576 });
    expect(widgetWindowSize("left", "panel", dimensions)).toEqual({ width: 656, height: 764 });
  });

  it("expands settings and activity windows enough to contain the configured dock", () => {
    const dimensions = { longSide: 720, thickness: 240 };
    expect(widgetWindowSize("top", "settings", dimensions)).toEqual({ width: 764, height: 268 });
    expect(widgetWindowSize("left", "panel", { ...dimensions, panelSize: { width: 380, height: 300 } })).toEqual({ width: 656, height: 764 });
  });

  it("keeps the restore strip compact regardless of saved dimensions", () => {
    expect(widgetWindowSize("bottom", "hidden", { longSide: 720, thickness: 240 })).toEqual({
      width: 48,
      height: 44,
    });
  });
});
