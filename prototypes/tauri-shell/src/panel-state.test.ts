import { describe, expect, it } from "vitest";
import { reduceShellState, type ShellState } from "./panel-state";

describe("input panel state", () => {
  it("keeps the current draft when the panel is closed and reopened", () => {
    const initial: ShellState = { panel: "summary", draft: "" };
    const editing = reduceShellState(initial, { type: "toggle-input" });
    const withDraft = reduceShellState(editing, { type: "edit-draft", value: "local sample" });
    const closed = reduceShellState(withDraft, { type: "close-input" });
    const reopened = reduceShellState(closed, { type: "toggle-input" });

    expect(closed.panel).toBe("summary");
    expect(reopened).toEqual({ panel: "input", draft: "local sample" });
  });
});
