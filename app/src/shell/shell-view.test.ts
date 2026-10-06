import { describe, expect, it } from "vitest";
import {
  INITIAL_SHELL_INTERACTION_STATE,
  reduceShellInteraction,
  shouldDeferHoverClearWhilePressed,
} from "./shell-view";

describe("the shell interaction state", () => {
  it("shows a module summary on hover without opening the activity panel", () => {
    const state = reduceShellInteraction(INITIAL_SHELL_INTERACTION_STATE, {
      type: "hover-module",
      moduleId: "cpu",
    });

    expect(state).toMatchObject({
      hoveredModuleId: "cpu",
      activeModuleId: null,
      settingsOpen: false,
    });
  });

  it("opens at most one activity panel and clears the hover preview", () => {
    const state = reduceShellInteraction(
      { ...INITIAL_SHELL_INTERACTION_STATE, hoveredModuleId: "todo" },
      { type: "open-panel", moduleId: "cpu" },
    );

    expect(state.activeModuleId).toBe("cpu");
    expect(state.hoveredModuleId).toBeNull();
    expect(state.settingsOpen).toBe(false);
  });

  it("closes the activity panel and returns to the summary", () => {
    const state = reduceShellInteraction(
      { ...INITIAL_SHELL_INTERACTION_STATE, activeModuleId: "cpu" },
      { type: "close-panel" },
    );

    expect(state.activeModuleId).toBeNull();
  });

  it("replaces the selected module instead of stacking a second panel", () => {
    const state = reduceShellInteraction(
      { ...INITIAL_SHELL_INTERACTION_STATE, activeModuleId: "todo" },
      { type: "open-panel", moduleId: "cpu" },
    );

    expect(state.activeModuleId).toBe("cpu");
  });

  it("opens and closes settings independently of module data", () => {
    const opened = reduceShellInteraction(INITIAL_SHELL_INTERACTION_STATE, {
      type: "open-settings",
    });
    const closed = reduceShellInteraction(opened, { type: "close-settings" });

    expect(opened.settingsOpen).toBe(true);
    expect(closed.settingsOpen).toBe(false);
  });

  it.each(["todo", "focus", "cpu", "gpu", "memory", "media", "codex", "weather", "clipboard"])(
    "replaces the active %s panel with settings, matching the approved navigation",
    (moduleId) => {
      const opened = reduceShellInteraction(
        { ...INITIAL_SHELL_INTERACTION_STATE, activeModuleId: moduleId },
        { type: "open-settings" },
      );

      expect(opened).toEqual({
        activeModuleId: null,
        hoveredModuleId: null,
        settingsOpen: true,
        hidden: false,
      });
      expect(reduceShellInteraction(opened, { type: "close-settings" })).toEqual(
        INITIAL_SHELL_INTERACTION_STATE,
      );
    },
  );

  it("hides and restores the shell without losing the selected visibility target", () => {
    const hidden = reduceShellInteraction(
      {
        ...INITIAL_SHELL_INTERACTION_STATE,
        hoveredModuleId: "gpu",
        settingsOpen: true,
      },
      { type: "hide" },
    );
    const restored = reduceShellInteraction(hidden, { type: "restore" });

    expect(hidden).toEqual({
      activeModuleId: null,
      hoveredModuleId: null,
      settingsOpen: false,
      hidden: true,
    });
    expect(restored.hidden).toBe(false);
  });

  it("ignores module and settings opens while the shell is hidden", () => {
    const hidden = { ...INITIAL_SHELL_INTERACTION_STATE, hidden: true };
    expect(
      reduceShellInteraction(hidden, { type: "open-panel", moduleId: "cpu" }),
    ).toBe(hidden);
    expect(reduceShellInteraction(hidden, { type: "open-settings" })).toBe(
      hidden,
    );
  });

  it("keeps hover geometry stable while a module pointer press is in flight", () => {
    expect(shouldDeferHoverClearWhilePressed(true)).toBe(true);
    expect(shouldDeferHoverClearWhilePressed(false)).toBe(false);
  });
});
