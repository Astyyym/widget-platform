export type PanelName = "summary" | "input";

export interface ShellState {
  panel: PanelName;
  draft: string;
}

export type ShellAction =
  | { type: "toggle-input" }
  | { type: "close-input" }
  | { type: "edit-draft"; value: string };

export function reduceShellState(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "toggle-input":
      return { ...state, panel: state.panel === "input" ? "summary" : "input" };
    case "close-input":
      return { ...state, panel: "summary" };
    case "edit-draft":
      return { ...state, draft: action.value };
  }
}
