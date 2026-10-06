import { availableMonitors, currentMonitor, cursorPosition, PhysicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { DRAG_PREVIEW_EDGES, dragPreviewEdgeAtPoint, dragPreviewTargetRects, type DragPreviewDimensions, type DragPreviewTargets, type PreviewEdge } from "./drag-preview-geometry";
export { DRAG_PREVIEW_EDGES, type PreviewEdge } from "./drag-preview-geometry";

const PREVIEW_LABELS: Record<PreviewEdge, string> = {
  top: "drag-preview-top",
  right: "drag-preview-right",
  bottom: "drag-preview-bottom",
  left: "drag-preview-left",
};
let previewTimer: number | undefined;
let currentCandidate: PreviewEdge | null = null;
let currentTargets: DragPreviewTargets | null = null;
let dragging = false;
let dragRevision = 0;
let nativeQueue: Promise<void> = Promise.resolve();
const knownWindows: Partial<Record<PreviewEdge, WebviewWindow>> = {};

function enqueueNative(operation: () => Promise<void>): Promise<void> {
  const result = nativeQueue.catch(() => undefined).then(operation);
  nativeQueue = result;
  return result;
}

export function getDragPreviewCandidate(): PreviewEdge | null {
  return currentCandidate;
}

export function resetDragPreviewCandidate(): void {
  currentCandidate = null;
}

export function visibleDragPreviewEdges(dragging: boolean): PreviewEdge[] {
  return dragging ? [...DRAG_PREVIEW_EDGES] : [];
}

type PreviewMonitor = Awaited<ReturnType<typeof currentMonitor>>;

function windowGeometry(edge: PreviewEdge, monitor: PreviewMonitor, dimensions: DragPreviewDimensions) {
  if (!monitor) return null;
  const area = monitor.workArea;
  const rect = dragPreviewTargetRects({
    ...area.position, ...area.size,
  }, monitor.scaleFactor, dimensions)[edge];
  return {
    position: new PhysicalPosition(rect.x, rect.y),
    size: new PhysicalSize(rect.width, rect.height),
  };
}

async function previewWindows(): Promise<Partial<Record<PreviewEdge, WebviewWindow>>> {
  const entries = await Promise.all(DRAG_PREVIEW_EDGES.map(async (edge) => {
    const label = PREVIEW_LABELS[edge];
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      knownWindows[edge] = existing;
      return [edge, existing] as const;
    }
    const created = new WebviewWindow(label, {
      title: "Widget Platform 拖动目标",
      url: `index.html?window=drag-preview&edge=${edge}`,
      width: 1,
      height: 1,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focus: false,
      visible: false,
      shadow: false,
    });
    knownWindows[edge] = created;
    await new Promise<void>((resolve, reject) => {
      void created.once("tauri://created", () => resolve());
      void created.once("tauri://error", (event) => reject(event.payload));
    });
    return [edge, created] as const;
  }));
  return Object.fromEntries(entries.filter((entry): entry is [PreviewEdge, WebviewWindow] => entry[1] !== null));
}

export async function previewEdgeAtCursor(): Promise<PreviewEdge | null> {
  if (!dragging || !currentTargets) return null;
  const revision = dragRevision;
  const point = await cursorPosition();
  return dragging && revision === dragRevision && currentTargets
    ? dragPreviewEdgeAtPoint(currentTargets, point) : null;
}

export async function openDragPreviewWindow(
  activeEdge: PreviewEdge | null,
  dimensions: DragPreviewDimensions,
): Promise<void> {
  const revision = ++dragRevision;
  dragging = true;
  currentCandidate = null;
  if (previewTimer !== undefined) window.clearInterval(previewTimer);
  previewTimer = undefined;
  try {
    await enqueueNative(async () => {
      if (!dragging || revision !== dragRevision) return;
      const monitor = (await currentMonitor()) ?? (await availableMonitors())[0];
      if (!monitor) throw new Error("No display is available for drag targets.");
      const windows = await previewWindows();
      if (!dragging || revision !== dragRevision) return;
      currentTargets = dragPreviewTargetRects({ ...monitor.workArea.position, ...monitor.workArea.size }, monitor.scaleFactor, dimensions);
      await Promise.all(visibleDragPreviewEdges(true).map(async (edge) => {
        const preview = windows[edge];
        const geometry = windowGeometry(edge, monitor, dimensions);
        if (!preview || !geometry) return;
        await preview.setSize(geometry.size);
        await preview.setPosition(geometry.position);
        await preview.setIgnoreCursorEvents(true);
        if (!dragging || revision !== dragRevision) return;
        await preview.emit("drag-preview-update", { activeEdge });
        await preview.show();
      }));
    });
    if (!dragging || revision !== dragRevision) return;
    let polling = false;
    previewTimer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void previewEdgeAtCursor().then((edge) => {
        if (dragging && revision === dragRevision && edge !== currentCandidate) return updateDragPreview(edge);
      }).catch((error: unknown) => {
        console.error("Could not update desktop drag target:", error);
        void closeDragPreviewWindow();
      }).finally(() => { polling = false; });
    }, 80);
  } catch (error) {
    await closeDragPreviewWindow();
    throw error;
  }
}

export async function updateDragPreview(activeEdge: PreviewEdge | null): Promise<void> {
  if (!dragging) return;
  const revision = dragRevision;
  currentCandidate = activeEdge;
  await enqueueNative(async () => {
    if (!dragging || revision !== dragRevision) return;
    await Promise.all(Object.values(knownWindows).map((preview) =>
      preview.emit("drag-preview-update", { activeEdge })));
  });
}

export async function closeDragPreviewWindow(): Promise<void> {
  dragging = false;
  dragRevision++;
  currentCandidate = null;
  currentTargets = null;
  if (previewTimer !== undefined) {
    window.clearInterval(previewTimer);
    previewTimer = undefined;
  }
  await enqueueNative(async () => {
    await Promise.all(Object.values(knownWindows).map((preview) => preview.hide()));
  });
}