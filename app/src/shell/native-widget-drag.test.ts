import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWidgetWindowController, type WidgetWindowController } from "./native-widget-window";

const seam = vi.hoisted(() => ({
  invoke: vi.fn(), moved: undefined as (() => void) | undefined,
  setSize: vi.fn(), setPosition: vi.fn(), startDragging: vi.fn(),
}));
const monitor = { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } }, scaleFactor: 1 };
vi.mock("@tauri-apps/api/core", () => ({ invoke: seam.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: async () => [monitor], currentMonitor: async () => monitor, primaryMonitor: async () => monitor,
  LogicalSize: class { constructor(public width: number, public height: number) {} },
  PhysicalPosition: class { constructor(public x: number, public y: number) {} },
  getCurrentWindow: () => ({
    setSize: seam.setSize, setPosition: seam.setPosition, startDragging: seam.startDragging,
    outerSize: async () => ({ width: 624, height: 108 }), outerPosition: async () => ({ x: 650, y: 0 }),
    show: async () => undefined, onMoved: async (fn: () => void) => { seam.moved = fn; return () => undefined; },
  }),
}));
let controller: WidgetWindowController | undefined;
beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.useFakeTimers();
  vi.clearAllMocks();
  seam.invoke.mockResolvedValue(true);
  seam.setSize.mockResolvedValue(undefined);
  seam.setPosition.mockResolvedValue(undefined);
  seam.startDragging.mockResolvedValue(undefined);
});
afterEach(() => { controller?.dispose(); controller = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("explicit native drag release", () => {
  it("finishes a no-movement drag only after left-button release", async () => {
    const docked = vi.fn();
    const candidate = vi.fn().mockResolvedValue(null);
    controller = await createWidgetWindowController("top", 0.5, "compact", { longSide: 580, thickness: 80 }, docked, candidate);
    await vi.advanceTimersByTimeAsync(500);
    const dragging = controller.startDrag();
    await vi.advanceTimersByTimeAsync(400);
    expect(docked).not.toHaveBeenCalled();
    expect(candidate).not.toHaveBeenCalled();
    seam.invoke.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(100);
    await dragging;
    expect(candidate).toHaveBeenCalledTimes(1);
    expect(docked).toHaveBeenCalledWith("top", 0.5);
  });

  it("uses the release-time asynchronous candidate after a long held pause", async () => {
    const docked = vi.fn();
    const candidate = vi.fn().mockResolvedValue("left");
    controller = await createWidgetWindowController("top", 0.5, "compact", { longSide: 580, thickness: 80 }, docked, candidate);
    await vi.advanceTimersByTimeAsync(500);
    const dragging = controller.startDrag();
    seam.moved?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(candidate).not.toHaveBeenCalled();
    expect(docked).not.toHaveBeenCalled();
    candidate.mockResolvedValue("right");
    seam.invoke.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(100);
    await dragging;
    expect(docked).toHaveBeenCalledWith("right", 0.5);
  });

  it("does not start native movement if the button was released during preparation", async () => {
    const docked = vi.fn();
    controller = await createWidgetWindowController("top", 0.5, "compact", { longSide: 580, thickness: 80 }, docked);
    seam.invoke.mockResolvedValue(false);
    await controller.startDrag();
    expect(seam.startDragging).not.toHaveBeenCalled();
    expect(docked).not.toHaveBeenCalled();
  });

  it("does not commit a delayed release result after disposal", async () => {
    let release!: (edge: "left") => void;
    const candidate = vi.fn(() => new Promise<"left">((resolve) => { release = resolve; }));
    const docked = vi.fn();
    controller = await createWidgetWindowController("top", 0.5, "compact", { longSide: 580, thickness: 80 }, docked, candidate);
    await vi.advanceTimersByTimeAsync(500);
    const dragging = controller.startDrag();
    await vi.advanceTimersByTimeAsync(100);
    seam.invoke.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(candidate).toHaveBeenCalledTimes(1);
    controller.dispose();
    release("left");
    await dragging;
    expect(docked).not.toHaveBeenCalled();
  });
});
