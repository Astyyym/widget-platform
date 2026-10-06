import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  closeDragPreviewWindow, DRAG_PREVIEW_EDGES, getDragPreviewCandidate,
  openDragPreviewWindow, previewEdgeAtCursor, updateDragPreview, visibleDragPreviewEdges,
} from "./drag-preview-window";

const native = vi.hoisted(() => {
  const windows = new Map<string, {
    show: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn>;
    setSize: ReturnType<typeof vi.fn>; setPosition: ReturnType<typeof vi.fn>;
    setIgnoreCursorEvents: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>;
  }>();
  return { windows, cursor: vi.fn(), monitors: vi.fn(), currentMonitor: vi.fn() };
});
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: native.monitors, currentMonitor: native.currentMonitor,
  cursorPosition: native.cursor,
  LogicalSize: class { constructor(public width: number, public height: number) {} },
  PhysicalSize: class { constructor(public width: number, public height: number) {} },
  PhysicalPosition: class { constructor(public x: number, public y: number) {} },
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getByLabel: async (label: string) => native.windows.get(label) },
}));
const monitor = {
  name: "test", position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 },
  scaleFactor: 1, workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
};
const dimensions = {
  top: { longSide: 580, thickness: 80 }, bottom: { longSide: 580, thickness: 80 },
  left: { longSide: 580, thickness: 80 }, right: { longSide: 580, thickness: 80 },
};
beforeEach(async () => {
  vi.stubGlobal("window", globalThis);
  vi.useFakeTimers();
  for (const edge of DRAG_PREVIEW_EDGES) if (!native.windows.has(`drag-preview-${edge}`)) native.windows.set(`drag-preview-${edge}`, {
    show: vi.fn().mockResolvedValue(undefined), hide: vi.fn().mockResolvedValue(undefined),
    setSize: vi.fn().mockResolvedValue(undefined), setPosition: vi.fn().mockResolvedValue(undefined),
    setIgnoreCursorEvents: vi.fn().mockResolvedValue(undefined), emit: vi.fn().mockResolvedValue(undefined),
  });
  await closeDragPreviewWindow();
  vi.clearAllMocks();
  native.monitors.mockResolvedValue([monitor]);
  native.currentMonitor.mockResolvedValue(monitor);
  native.cursor.mockResolvedValue({ x: 960, y: 520 });
});
afterEach(async () => {
  await closeDragPreviewWindow();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("drag preview window visibility", () => {
  it("shows all four compact targets as soon as dragging begins", () => {
    expect(visibleDragPreviewEdges(true)).toEqual(DRAG_PREVIEW_EDGES);
  });

  it("hides all targets outside the drag lifecycle", () => {
    expect(visibleDragPreviewEdges(false)).toEqual([]);
  });
});

describe("desktop preview geometry and cursor", () => {
  it("uses the target edge orientation and only the visible dock dimensions", async () => {
    await openDragPreviewWindow(null, dimensions);
    const left = native.windows.get("drag-preview-left")!;
    const top = native.windows.get("drag-preview-top")!;
    expect(left.setSize.mock.calls.at(-1)?.[0]).toMatchObject({ width: 80, height: 580 });
    expect(top.setSize.mock.calls.at(-1)?.[0]).toMatchObject({ width: 580, height: 80 });
  });

  it("does not activate a broad edge band outside the visible target", async () => {
    await openDragPreviewWindow(null, dimensions);
    native.cursor.mockResolvedValue({ x: 130, y: 520 });
    expect(await previewEdgeAtCursor()).toBeNull();
    native.cursor.mockResolvedValue({ x: 40, y: 520 });
    expect(await previewEdgeAtCursor()).toBe("left");
  });

  it("never reopens closed previews from a late candidate update", async () => {
    await openDragPreviewWindow(null, dimensions);
    await closeDragPreviewWindow();
    vi.clearAllMocks();
    await updateDragPreview("left");
    expect(getDragPreviewCandidate()).toBeNull();
    for (const preview of native.windows.values()) expect(preview.show).not.toHaveBeenCalled();
  });

  it("keeps all four targets visible when only one becomes active", async () => {
    await openDragPreviewWindow(null, dimensions);
    vi.clearAllMocks();
    await updateDragPreview("left");
    for (const preview of native.windows.values()) {
      expect(preview.hide).not.toHaveBeenCalled();
      expect(preview.emit).toHaveBeenLastCalledWith("drag-preview-update", { activeEdge: "left" });
    }
  });

  it("serializes closing after an in-flight native show", async () => {
    let release!: () => void;
    const left = native.windows.get("drag-preview-left")!;
    left.show.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const opening = openDragPreviewWindow(null, dimensions);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const closing = closeDragPreviewWindow();
    release();
    await Promise.all([opening, closing]);
    expect(left.hide.mock.invocationCallOrder.at(-1)).toBeGreaterThan(left.show.mock.invocationCallOrder.at(-1)!);
    expect(getDragPreviewCandidate()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
