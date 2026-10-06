export type ShellInteractionState = {
  activeModuleId: string | null;
  hoveredModuleId: string | null;
  settingsOpen: boolean;
  hidden: boolean;
};

export type ShellInteractionAction =
  | { type: "hover-module"; moduleId: string | null }
  | { type: "open-panel"; moduleId: string }
  | { type: "close-panel" }
  | { type: "open-settings" }
  | { type: "close-settings" }
  | { type: "hide" }
  | { type: "restore" };

export const INITIAL_SHELL_INTERACTION_STATE: ShellInteractionState = {
  activeModuleId: null,
  hoveredModuleId: null,
  settingsOpen: false,
  hidden: false,
};

export function shouldDeferHoverClearWhilePressed(pointerDown: boolean): boolean {
  return pointerDown;
}

export function reduceShellInteraction(
  current: ShellInteractionState,
  action: ShellInteractionAction,
): ShellInteractionState {
  switch (action.type) {
    case "hover-module":
      if (current.hidden || current.activeModuleId || current.settingsOpen) {
        return current;
      }
      return { ...current, hoveredModuleId: action.moduleId };
    case "open-panel":
      if (current.hidden) return current;
      return {
        ...current,
        activeModuleId: action.moduleId,
        hoveredModuleId: null,
        settingsOpen: false,
      };
    case "close-panel":
      return { ...current, activeModuleId: null, hoveredModuleId: null };
    case "open-settings":
      if (current.hidden) return current;
      return { ...current, activeModuleId: null, settingsOpen: true, hoveredModuleId: null };
    case "close-settings":
      return { ...current, settingsOpen: false };
    case "hide":
      return {
        activeModuleId: null,
        hoveredModuleId: null,
        settingsOpen: false,
        hidden: true,
      };
    case "restore":
      return { ...current, hidden: false };
  }
}
