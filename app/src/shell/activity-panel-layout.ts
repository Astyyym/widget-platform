import type { PopoverSize } from "./popover-layout";

export const ACTIVITY_PANEL_GAP = 18;
export const ACTIVITY_PANEL_INSET = 18;

export function activityPanelSize(
  bounds: PopoverSize,
  content: { scrollHeight: number; clientHeight: number; offsetHeight: number },
): PopoverSize {
  const border = Math.max(0, content.offsetHeight - content.clientHeight);
  return {
    width: Math.ceil(bounds.width),
    height: Math.ceil(Math.max(bounds.height, content.scrollHeight + border)),
  };
}
