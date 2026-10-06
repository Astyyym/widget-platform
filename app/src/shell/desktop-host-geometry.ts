import type { ShellEdge } from "./shell-layout";

export type PhysicalPoint = { x: number; y: number };
export type PhysicalSize = { width: number; height: number };
export type PhysicalRect = PhysicalPoint & PhysicalSize;
export type DesktopWorkArea = PhysicalRect;

export type DockPlacement = {
  edge: ShellEdge;
  offset: number;
  position: PhysicalPoint;
};

const EDGES: readonly ShellEdge[] = ["top", "right", "bottom", "left"];


export function dockPosition(
  workArea: DesktopWorkArea,
  edge: ShellEdge,
  _offset: number,
  windowSize: PhysicalSize,
): PhysicalPoint {
  const travelX = Math.max(0, workArea.width - windowSize.width);
  const travelY = Math.max(0, workArea.height - windowSize.height);
  const position = {
    x: workArea.x + Math.round(travelX / 2),
    y: workArea.y + Math.round(travelY / 2),
  };

  if (edge === "top") position.y = workArea.y;
  if (edge === "right") position.x = workArea.x + workArea.width - windowSize.width;
  if (edge === "bottom") position.y = workArea.y + workArea.height - windowSize.height;
  if (edge === "left") position.x = workArea.x;
  return position;
}

export function nearestDockPlacement(
  workArea: DesktopWorkArea,
  position: PhysicalPoint,
  windowSize: PhysicalSize,
): DockPlacement {
  const distances: Record<ShellEdge, number> = {
    top: Math.abs(position.y - workArea.y),
    right: Math.abs(workArea.x + workArea.width - (position.x + windowSize.width)),
    bottom: Math.abs(workArea.y + workArea.height - (position.y + windowSize.height)),
    left: Math.abs(position.x - workArea.x),
  };
  const edge = EDGES.reduce((best, candidate) =>
    distances[candidate] < distances[best] ? candidate : best,
  );
  return { edge, offset: 0.5, position: dockPosition(workArea, edge, 0.5, windowSize) };
}

export function monitorDistanceSquared(
  point: PhysicalPoint,
  bounds: PhysicalRect,
): number {
  const dx = point.x < bounds.x
    ? bounds.x - point.x
    : point.x > bounds.x + bounds.width
      ? point.x - bounds.x - bounds.width
      : 0;
  const dy = point.y < bounds.y
    ? bounds.y - point.y
    : point.y > bounds.y + bounds.height
      ? point.y - bounds.y - bounds.height
      : 0;
  return dx * dx + dy * dy;
}

export function rectCenter(position: PhysicalPoint, size: PhysicalSize): PhysicalPoint {
  return { x: position.x + size.width / 2, y: position.y + size.height / 2 };
}
