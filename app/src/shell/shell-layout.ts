export type ShellEdge = "top" | "right" | "bottom" | "left";
export type ShellRingMode = "off" | "inner" | "outer";

export type ShellLayoutInput = {
  stageWidth: number;
  stageHeight: number;
  edge: ShellEdge;
  itemCount: number;
  iconSize: number;
  ringMode: ShellRingMode;
  longSide?: number;
  thickness?: number;
  rows?: number;
};

export type ShellLayout = {
  horizontal: boolean;
  longSide: number;
  thickness: number;
  hitSize: number;
  iconSize: number;
  itemsPerLine: number;
  lineCount: number;
  availableAlong: number;
  minimumLongSide: number;
  minimumThickness: number;
  gridPadding?: number;
};

export type ShellPoint = { x: number; y: number };

export type ShellRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ShellDropTarget = { edge: ShellEdge; rect: ShellRect };

export type ShellDrop = {
  edge: ShellEdge;
  offset: number;
  centered: boolean;
};

export const ICON_SIZE_MIN = 20;
export const ICON_SIZE_MAX = 52;
export const ICON_SIZE_DEFAULT = 46;
export const SHELL_LONG_SIDE_DEFAULT = 260;
export const SHELL_THICKNESS_DEFAULT = 80;
const HIT_AREA_MIN = 28;
const LAYOUT_GAP = 4;
const LAYOUT_PADDING = 8;
const LAYOUT_BORDER = 2;
const EDGE_CLEARANCE = 136;
const THICKNESS_MIN = 40;
const THICKNESS_MAX = 240;

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function edgeLength(count: number, hitSize: number, padding = LAYOUT_PADDING): number {
  return (
    count * hitSize +
    Math.max(0, count - 1) * LAYOUT_GAP +
    2 * padding +
    LAYOUT_BORDER
  );
}

export function calculateShellLayout(input: ShellLayoutInput): ShellLayout {
  const horizontal = input.edge === "top" || input.edge === "bottom";
  const itemCount = Math.max(1, Math.floor(finiteOr(input.itemCount, 1)));
  const iconSize = Math.max(
    ICON_SIZE_MIN,
    Math.min(ICON_SIZE_MAX, finiteOr(input.iconSize, ICON_SIZE_DEFAULT)),
  );
  const thickness = Math.max(
    THICKNESS_MIN,
    Math.min(
      THICKNESS_MAX,
      finiteOr(input.thickness, SHELL_THICKNESS_DEFAULT),
    ),
  );
  const requestedLongSide = Math.max(
    96,
    finiteOr(input.longSide, SHELL_LONG_SIDE_DEFAULT),
  );
  const hitSize = Math.max(
    HIT_AREA_MIN,
    iconSize + (input.ringMode === "outer" ? 14 : 4),
  );
  const requestedRows = Math.max(1, Math.min(itemCount, Math.floor(finiteOr(input.rows, 1))));
  const gridPadding = iconSize < 34 ? 4 : LAYOUT_PADDING;
  const requestedItemsPerLine = Math.ceil(itemCount / requestedRows);
  const minimumLongSide = edgeLength(requestedItemsPerLine, hitSize, gridPadding);
  const singleItemLength = edgeLength(1, hitSize, gridPadding);
  const stageLength = Math.max(
    0,
    finiteOr(
      horizontal ? input.stageWidth : input.stageHeight,
      singleItemLength,
    ),
  );
  const availableAlong = Math.max(singleItemLength, stageLength - EDGE_CLEARANCE);
  const longSide = Math.min(
    Math.max(requestedLongSide, minimumLongSide),
    availableAlong,
  );
  const itemsPerLine = Math.max(
    1,
    Math.min(
      requestedItemsPerLine,
      Math.floor(
        (longSide - 2 * gridPadding - LAYOUT_BORDER + LAYOUT_GAP) /
          (hitSize + LAYOUT_GAP),
      ),
    ),
  );
  const lineCount = Math.max(requestedRows, Math.ceil(itemCount / itemsPerLine));
  const minimumThickness = edgeLength(lineCount, hitSize, gridPadding);

  return {
    horizontal,
    longSide,
    thickness: Math.max(thickness, minimumThickness),
    hitSize,
    iconSize,
    itemsPerLine,
    lineCount,
    availableAlong,
    minimumLongSide,
    minimumThickness,
    gridPadding,
  };
}

export function shellModuleGridPosition(index: number, itemCount: number, lineCount: number, horizontal: boolean): { gridRow: number; gridColumn: number } {
  const perLine = Math.floor(itemCount / lineCount);
  const extra = itemCount % lineCount;
  let remaining = index;
  for (let line = 0; line < lineCount; line++) {
    const length = perLine + (line < extra ? 1 : 0);
    if (remaining < length) return horizontal
      ? { gridRow: line + 1, gridColumn: remaining + 1 }
      : { gridRow: remaining + 1, gridColumn: line + 1 };
    remaining -= length;
  }
  return { gridRow: 1, gridColumn: 1 };
}

function containsPoint(rect: ShellRect, point: ShellPoint): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  );
}

export function resolveShellDrop(
  point: ShellPoint,
  _stage: { width: number; height: number },
  targetRects: readonly ShellDropTarget[],
  _occupiedAlong: number,
): ShellDrop | null {
  const target = targetRects.find(({ rect }) => containsPoint(rect, point));
  if (target) return { edge: target.edge, offset: 0.5, centered: true };
  return null;
}

export function shellDragPreviewPosition(
  drop: ShellDrop,
  _point: ShellPoint,
  stage: { width: number; height: number },
  dock: { width: number; height: number },
  _anchor: ShellPoint,
): ShellPoint {
  if (drop.centered) {
    if (drop.edge === "top") return { x: (stage.width - dock.width) / 2, y: 0 };
    if (drop.edge === "right") return { x: stage.width - dock.width, y: (stage.height - dock.height) / 2 };
    if (drop.edge === "bottom") return { x: (stage.width - dock.width) / 2, y: stage.height - dock.height };
    return { x: 0, y: (stage.height - dock.height) / 2 };
  }

  return { x: 0, y: 0 };
}
