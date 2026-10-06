import type { ShellEdge, ShellPoint, ShellRect } from "./shell-layout";

export const POPOVER_GAP = 12;
export const POPOVER_INSET = 12;
export const POPOVER_WIDTH = 286;
export type PopoverSize = { width: number; height: number };

// All rectangles are stage-local. Insufficient inward space must never be
// "fixed" by clamping the preview back over the dock.
export function shellPopoverPosition(
  edge: ShellEdge,
  stage: PopoverSize,
  dock: ShellRect,
  button: ShellRect,
  preview: PopoverSize,
): ShellPoint | null {
  const maxX = stage.width - preview.width - POPOVER_INSET;
  const maxY = stage.height - preview.height - POPOVER_INSET;
  if (preview.width <= 0 || preview.height <= 0 || maxX < POPOVER_INSET || maxY < POPOVER_INSET) return null;
  const clamp = (value: number, maximum: number) => Math.max(POPOVER_INSET, Math.min(maximum, value));
  let left = clamp(button.left + button.width / 2 - preview.width / 2, maxX);
  let top = clamp(button.top + button.height / 2 - preview.height / 2, maxY);
  if (edge === "top") top = dock.top + dock.height + POPOVER_GAP;
  else if (edge === "bottom") top = dock.top - preview.height - POPOVER_GAP;
  else if (edge === "left") left = dock.left + dock.width + POPOVER_GAP;
  else left = dock.left - preview.width - POPOVER_GAP;
  if (left < POPOVER_INSET || left > maxX || top < POPOVER_INSET || top > maxY) return null;
  return { x: left, y: top };
}
