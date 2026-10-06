import {
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  primaryMonitor,
  type Monitor,
} from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  dockPosition,
  monitorDistanceSquared,
  rectCenter,
  type DesktopWorkArea,
  type PhysicalRect,
  type PhysicalSize,
} from "./desktop-host-geometry";
import type { ShellEdge } from "./shell-layout";
import type { ShellInteractionState } from "./shell-view";
import { POPOVER_GAP, POPOVER_INSET, POPOVER_WIDTH, type PopoverSize } from "./popover-layout";
import { ACTIVITY_PANEL_GAP, ACTIVITY_PANEL_INSET } from "./activity-panel-layout";
import { invoke } from "@tauri-apps/api/core";

export type WidgetWindowMode = "compact" | "popover" | "panel" | "settings" | "hidden";

type WindowSize = { width: number; height: number };
export type WidgetWindowDimensions = {
  longSide: number;
  thickness: number;
  popoverSize?: PopoverSize;
  panelSize?: PopoverSize;
};
const DEFAULT_DIMENSIONS: WidgetWindowDimensions = { longSide: 260, thickness: 80 };

function horizontal(edge: ShellEdge): boolean {
  return edge === "top" || edge === "bottom";
}

export function widgetWindowSize(
  edge: ShellEdge,
  mode: WidgetWindowMode,
  dimensions: WidgetWindowDimensions = DEFAULT_DIMENSIONS,
): WindowSize {
  const across = horizontal(edge);
  if (mode === "hidden") return across ? { width: 48, height: 44 } : { width: 44, height: 48 };
  // The controls extend only a bounded amount beyond the dock. Do not keep
  // a generic transparent canvas around the actual content.
  const compact = across
    ? { width: dimensions.longSide + 44, height: dimensions.thickness + 28 }
    : { width: dimensions.thickness + 28, height: dimensions.longSide + 44 };
  if (mode === "compact") return compact;
  if (mode === "popover") {
    const preview = dimensions.popoverSize ?? { width: POPOVER_WIDTH, height: 0 };
    return across ? {
      width: Math.max(compact.width, preview.width + 2 * POPOVER_INSET),
      height: Math.max(compact.height, dimensions.thickness + POPOVER_GAP + preview.height + POPOVER_INSET),
    } : {
      width: Math.max(compact.width, dimensions.thickness + POPOVER_GAP + preview.width + POPOVER_INSET),
      height: Math.max(compact.height, preview.height + 2 * POPOVER_INSET),
    };
  }
  const panel = dimensions.panelSize;
  if (mode === "panel" && panel) {
    return across ? {
      width: Math.max(compact.width, panel.width + 2 * ACTIVITY_PANEL_INSET),
      height: Math.max(compact.height, dimensions.thickness + ACTIVITY_PANEL_GAP + panel.height + ACTIVITY_PANEL_INSET),
    } : {
      width: Math.max(compact.width, dimensions.thickness + ACTIVITY_PANEL_GAP + panel.width + ACTIVITY_PANEL_INSET),
      height: Math.max(compact.height, panel.height + 2 * ACTIVITY_PANEL_INSET),
    };
  }
  const expanded = compact;
  return {
    width: Math.max(expanded.width, compact.width),
    height: Math.max(expanded.height, compact.height),
  };
}

export function widgetWindowMode(interaction: ShellInteractionState): WidgetWindowMode {
  if (interaction.hidden) return "hidden";
  if (interaction.settingsOpen) return "settings";
  if (interaction.activeModuleId) return "panel";
  if (interaction.hoveredModuleId) return "popover";
  return "compact";
}

function monitorBounds(monitor: Monitor): PhysicalRect {
  return {
    x: monitor.position.x,
    y: monitor.position.y,
    width: monitor.size.width,
    height: monitor.size.height,
  };
}

function monitorWorkArea(monitor: Monitor): DesktopWorkArea {
  return {
    x: monitor.workArea.position.x,
    y: monitor.workArea.position.y,
    width: monitor.workArea.size.width,
    height: monitor.workArea.size.height,
  };
}

function pickMonitor(monitors: Monitor[], position: PhysicalPosition, size: PhysicalSize): Monitor | null {
  if (monitors.length === 0) return null;
  const center = rectCenter(position, size);
  return monitors.reduce((nearest, candidate) =>
    monitorDistanceSquared(center, monitorBounds(candidate)) <
      monitorDistanceSquared(center, monitorBounds(nearest))
      ? candidate
      : nearest,
  );
}

async function currentPlacementMonitor(): Promise<Monitor | null> {
  const [monitors, active, primary] = await Promise.all([
    availableMonitors(),
    currentMonitor(),
    primaryMonitor(),
  ]);
  return active ?? primary ?? monitors[0] ?? null;
}

export async function positionWidgetWindow(
  edge: ShellEdge,
  offset: number,
  mode: WidgetWindowMode,
  dimensions: WidgetWindowDimensions = DEFAULT_DIMENSIONS,
  preferredMonitor?: Monitor | null,
): Promise<void> {
  const appWindow = getCurrentWindow();
  const monitor = preferredMonitor ?? await currentPlacementMonitor();
  if (!monitor) throw new Error("Windows reported no available display for the widget.");

  const logical = widgetWindowSize(edge, mode, dimensions);
  if (mode === "popover" || mode === "panel") {
    const area = monitorWorkArea(monitor);
    logical.width = Math.min(logical.width, Math.floor(area.width / monitor.scaleFactor));
    logical.height = Math.min(logical.height, Math.floor(area.height / monitor.scaleFactor));
  }
  await appWindow.setSize(new LogicalSize(logical.width, logical.height));
  const physicalSize = await appWindow.outerSize();
  const target = dockPosition(monitorWorkArea(monitor), edge, offset, physicalSize);
  await appWindow.setPosition(new PhysicalPosition(target.x, target.y));
}

export type WidgetWindowController = {
  startDrag: () => Promise<void>;
  update: (
    edge: ShellEdge,
    offset: number,
    mode: WidgetWindowMode,
    dimensions?: WidgetWindowDimensions,
  ) => Promise<void>;
  dispose: () => void;
};

export async function createWidgetWindowController(
  initialEdge: ShellEdge,
  initialOffset: number,
  initialMode: WidgetWindowMode,
  initialDimensions: WidgetWindowDimensions,
  onDocked: (edge: ShellEdge, offset: number) => void,
  getDragCandidate: () => ShellEdge | null | Promise<ShellEdge | null> = () => null,
): Promise<WidgetWindowController> {
  const appWindow = getCurrentWindow();
  let disposed = false;
  let applyingGeometry = false;
  let dragging = false;
  let moveTimer: number | undefined;
  let releaseTimer: number | undefined;
  let currentMode = initialMode;
  let currentEdge = initialEdge;
  let currentDimensions = initialDimensions;
  let geometryRevision = 0;
  let geometryQueue: Promise<void> = Promise.resolve();
  let unlistenMoved: UnlistenFn | undefined;

  const apply = async (
    targetEdge: ShellEdge,
    targetOffset: number,
    targetMode: WidgetWindowMode,
    dimensions: WidgetWindowDimensions,
    monitor?: Monitor | null,
  ) => {
    applyingGeometry = true;
    try {
      await positionWidgetWindow(targetEdge, targetOffset, targetMode, dimensions, monitor);
    } finally {
      window.setTimeout(() => { applyingGeometry = false; }, 500);
    }
  };

  const enqueueGeometry = (
    targetEdge: ShellEdge,
    targetOffset: number,
    targetMode: WidgetWindowMode,
    dimensions: WidgetWindowDimensions,
    monitor?: Monitor | null,
  ) => {
    currentMode = targetMode;
    currentDimensions = dimensions;
    const revision = ++geometryRevision;
    const operation = geometryQueue.catch(() => undefined).then(async () => {
      if (disposed || revision !== geometryRevision) return;
      await apply(targetEdge, targetOffset, targetMode, dimensions, monitor);
    });
    geometryQueue = operation;
    return operation;
  };

  unlistenMoved = await appWindow.onMoved(() => {
    if (disposed || applyingGeometry || dragging) return;
    if (moveTimer !== undefined) window.clearTimeout(moveTimer);
    moveTimer = window.setTimeout(() => {
      void (async () => {
        if (disposed || applyingGeometry) return;
        if (await invoke<boolean>("native_left_button_is_down")) {
          if (releaseTimer !== undefined) window.clearTimeout(releaseTimer);
          const finalizeAfterRelease = () => {
            void invoke<boolean>("native_left_button_is_down").then((stillDown) => {
              if (disposed || applyingGeometry) return;
              if (stillDown) {
                releaseTimer = window.setTimeout(finalizeAfterRelease, 80);
                return;
              }
              void appWindow.outerPosition().then(async (position) => {
                if (disposed || applyingGeometry) return;
                const [size, monitors] = await Promise.all([appWindow.outerSize(), availableMonitors()]);
                const monitor = pickMonitor(monitors, position, size);
                if (!monitor) return;
                const edge = (await getDragCandidate()) ?? currentEdge;
                if (disposed || dragging) return;
                await enqueueGeometry(edge, 0.5, currentMode, currentDimensions, monitor);
                currentEdge = edge;
                onDocked(edge, 0.5);
              }).catch((error: unknown) => console.error("Could not finalize widget drag:", error));
            }).catch((error: unknown) => console.error("Could not read widget drag button state:", error));
          };
          releaseTimer = window.setTimeout(finalizeAfterRelease, 80);
          return;
        }
        const [position, size, monitors] = await Promise.all([
          appWindow.outerPosition(),
          appWindow.outerSize(),
          availableMonitors(),
        ]);
        const monitor = pickMonitor(monitors, position, size);
        if (!monitor) return;
        const edge = (await getDragCandidate()) ?? currentEdge;
        if (disposed || dragging) return;
        await enqueueGeometry(edge, 0.5, currentMode, currentDimensions, monitor);
        currentEdge = edge;
        onDocked(edge, 0.5);
      })().catch((error: unknown) => console.error("Could not snap the widget window:", error));
    }, 320);
  });

  await enqueueGeometry(initialEdge, initialOffset, initialMode, initialDimensions);
  await appWindow.show();

  return {
    startDrag: async () => {
      if (disposed || dragging) return;
      dragging = true;
      if (moveTimer !== undefined) window.clearTimeout(moveTimer);
      if (releaseTimer !== undefined) window.clearTimeout(releaseTimer);
      // The drag lifecycle is explicit: a click without movement also ends.
      // Keep the original monitor when releasing outside every visible target.
      const originalEdge = currentEdge;
      try {
        const originalMonitor = await currentPlacementMonitor();
        if (!(await invoke<boolean>("native_left_button_is_down"))) return;
        await appWindow.startDragging();
        while (!disposed && await invoke<boolean>("native_left_button_is_down")) {
          await new Promise<void>((resolve) => { releaseTimer = window.setTimeout(resolve, 80); });
        }
        if (disposed) return;
        // Re-read the cursor target on release, not the previous polling tick.
        const edge = (await getDragCandidate()) ?? originalEdge;
        if (disposed) return;
        await enqueueGeometry(edge, 0.5, currentMode, currentDimensions, originalMonitor);
        if (disposed) return;
        currentEdge = edge;
        onDocked(edge, 0.5);
      } finally {
        dragging = false;
      }
    },
    update: async (edge, offset, mode, dimensions = initialDimensions) => {
      currentEdge = edge;
      await enqueueGeometry(edge, offset, mode, dimensions);
    },
    dispose: () => {
      disposed = true;
      if (moveTimer !== undefined) window.clearTimeout(moveTimer);
      if (releaseTimer !== undefined) window.clearTimeout(releaseTimer);
      unlistenMoved?.();
    },
  };
}
