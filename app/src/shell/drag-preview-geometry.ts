import { dockPosition, type DesktopWorkArea, type PhysicalPoint, type PhysicalRect } from "./desktop-host-geometry";
import type { ShellEdge } from "./shell-layout";

export const DRAG_PREVIEW_EDGES = ["top", "right", "bottom", "left"] as const;
export type PreviewEdge = ShellEdge;
export type DragPreviewDimensions = Record<PreviewEdge, { longSide: number; thickness: number }>;
export type DragPreviewTargets = Record<PreviewEdge, PhysicalRect>;

// These rectangles are both the native preview bounds and the cursor targets.
// Only the visible dock is previewed, not its transparent control allowance.
export function dragPreviewTargetRects(
  area: DesktopWorkArea,
  scale: number,
  dimensions: DragPreviewDimensions,
): DragPreviewTargets {
  return Object.fromEntries(DRAG_PREVIEW_EDGES.map((edge) => {
    const horizontal = edge === "top" || edge === "bottom";
    const { longSide, thickness } = dimensions[edge];
    const size = {
      width: Math.min(area.width, Math.max(1, Math.round((horizontal ? longSide : thickness) * scale))),
      height: Math.min(area.height, Math.max(1, Math.round((horizontal ? thickness : longSide) * scale))),
    };
    return [edge, { ...dockPosition(area, edge, 0.5, size), ...size }];
  })) as DragPreviewTargets;
}

export function dragPreviewEdgeAtPoint(targets: DragPreviewTargets, point: PhysicalPoint): PreviewEdge | null {
  return DRAG_PREVIEW_EDGES.find((edge) => {
    const rect = targets[edge];
    return point.x >= rect.x && point.x < rect.x + rect.width
      && point.y >= rect.y && point.y < rect.y + rect.height;
  }) ?? null;
}
