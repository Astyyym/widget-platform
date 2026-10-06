import { describe, expect, it } from "vitest";
import { clipboardListenerShouldRun } from "./clipboard-lifecycle";

describe("clipboard listener lifecycle", () => {
  it("runs whenever the Clipboard module is enabled, independent of panel visibility", () => {
    expect(clipboardListenerShouldRun({ isFixture: false, moduleEnabled: true })).toBe(true);
    expect(clipboardListenerShouldRun({ isFixture: false, moduleEnabled: true, hidden: true })).toBe(true);
    expect(clipboardListenerShouldRun({ isFixture: false, moduleEnabled: true, settingsOpen: true })).toBe(true);
  });

  it("stays off for fixtures or when the module is hidden", () => {
    expect(clipboardListenerShouldRun({ isFixture: true, moduleEnabled: true })).toBe(false);
    expect(clipboardListenerShouldRun({ isFixture: false, moduleEnabled: false })).toBe(false);
  });
});
