export type DockEdge = "top" | "right" | "bottom" | "left";

export interface PhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LogicalWindowSize {
  width: number;
  height: number;
}

export interface PhysicalPoint {
  x: number;
  y: number;
}

export interface PhysicalSize {
  width: number;
  height: number;
}

export interface DockGeometry {
  position: PhysicalPoint;
  /** Physical client/content size to pass to the window resize API. */
  size: PhysicalSize;
  /** Physical outer bounds used for alignment, including native window margins. */
  boundsSize: PhysicalSize;
  ratio: number;
  sizeClamped: boolean;
}

export interface MonitorCandidate<T> {
  id: string;
  primary: boolean;
  value: T;
}

export interface MonitorResolution<T> {
  monitor: MonitorCandidate<T> | null;
  usedFallback: boolean;
}

/**
 * ratio marks a fraction of the remaining travel along the chosen edge:
 * 0 is the start, 0.5 is centered, and 1 is the end.
 * Work-area coordinates and returned positions are physical desktop pixels.
 */
export function computeDockGeometry(
  workArea: PhysicalRect,
  edge: DockEdge,
  ratio: number,
  logicalSize: LogicalWindowSize,
  scaleFactor: number,
  frameExtent: PhysicalSize = { width: 0, height: 0 },
): DockGeometry {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    throw new RangeError("scaleFactor must be a finite positive number");
  }
  if (
    !Number.isFinite(logicalSize.width) ||
    !Number.isFinite(logicalSize.height) ||
    logicalSize.width <= 0 ||
    logicalSize.height <= 0
  ) {
    throw new RangeError("logical window dimensions must be finite positive numbers");
  }

  const normalizedRatio = Number.isFinite(ratio)
    ? Math.min(1, Math.max(0, ratio))
    : 0.5;
  const requestedWidth = Math.round(logicalSize.width * scaleFactor);
  const requestedHeight = Math.round(logicalSize.height * scaleFactor);
  const extentWidth = Math.max(0, Math.round(frameExtent.width));
  const extentHeight = Math.max(0, Math.round(frameExtent.height));
  const width = Math.min(Math.max(0, workArea.width - extentWidth), requestedWidth);
  const height = Math.min(Math.max(0, workArea.height - extentHeight), requestedHeight);
  const boundsWidth = Math.min(workArea.width, width + extentWidth);
  const boundsHeight = Math.min(workArea.height, height + extentHeight);
  const travelX = Math.max(0, workArea.width - boundsWidth);
  const travelY = Math.max(0, workArea.height - boundsHeight);

  let x = workArea.x + Math.round(travelX * normalizedRatio);
  let y = workArea.y + Math.round(travelY * normalizedRatio);

  switch (edge) {
    case "top":
      y = workArea.y;
      break;
    case "right":
      x = workArea.x + workArea.width - boundsWidth;
      break;
    case "bottom":
      y = workArea.y + workArea.height - boundsHeight;
      break;
    case "left":
      x = workArea.x;
      break;
  }

  return {
    position: { x, y },
    size: { width, height },
    boundsSize: { width: boundsWidth, height: boundsHeight },
    ratio: normalizedRatio,
    sizeClamped: width !== requestedWidth || height !== requestedHeight,
  };
}

export function resolveMonitor<T>(
  preferredId: string | null,
  monitors: MonitorCandidate<T>[],
): MonitorResolution<T> {
  if (preferredId !== null) {
    const preferred = monitors.find((monitor) => monitor.id === preferredId);
    if (preferred) {
      return { monitor: preferred, usedFallback: false };
    }
  }

  const fallback = monitors.find((monitor) => monitor.primary) ?? monitors[0] ?? null;
  return {
    monitor: fallback,
    usedFallback: preferredId !== null && fallback !== null,
  };
}
