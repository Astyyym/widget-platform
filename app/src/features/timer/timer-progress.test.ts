import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimerSnapshot } from "./timer-store";
import { ShellFrame } from "../../shell/ShellFrame";
const state = vi.hoisted(() => ({ snapshot: null as TimerSnapshot | null }));
vi.mock("./timer-store", async (original) => ({
  ...await original<typeof import("./timer-store")>(),
  TimerSnapshotStore: class { getSnapshot() { return state.snapshot; } },
}));
const running: TimerSnapshot = { schemaVersion: 1, revision: 1, instanceId: "test", phase: "focus", state: "running", durationMs: 10_000, remainingMs: 10_000, deadlineUtc: 15_000, generation: 1, completionId: null, clockAnomaly: false };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); state.snapshot = running; });
afterEach(() => { vi.useRealTimers(); });
function ring() {
  const markup = renderToStaticMarkup(createElement(ShellFrame, { isFixture: false }));
  return markup.match(/<button[^>]*data-module-id="focus"[\s\S]*?<\/button>/)?.[0] ?? "";
}
describe("timer summary countdown ring", () => {
  it("drives the real summary ring from the current deadline instead of a cached remainingMs", () => {
    expect(ring()).toContain("--shell-ring-progress:50%");
  });
  it("freezes the paused ring and continues from the resumed deadline", () => {
    state.snapshot = { ...running, state: "paused", remainingMs: 4_000, deadlineUtc: null };
    expect(ring()).toContain("--shell-ring-progress:40%");
    vi.setSystemTime(60_000);
    expect(ring()).toContain("--shell-ring-progress:40%");
    state.snapshot = { ...state.snapshot, state: "running", deadlineUtc: 64_000 };
    expect(ring()).toContain("--shell-ring-progress:40%");
  });
  it("starts with a full ring, completes empty, and removes the ring after reset", () => {
    state.snapshot = { ...running, deadlineUtc: 20_000 };
    expect(ring()).toContain("--shell-ring-progress:100%");
    state.snapshot = { ...running, state: "completed", remainingMs: 0, deadlineUtc: null };
    expect(ring()).toContain("--shell-ring-progress:0%");
    state.snapshot = { ...running, state: "idle", deadlineUtc: null };
    expect(ring()).toContain('data-has-progress="false"');
    state.snapshot = null;
    expect(ring()).toContain('data-has-progress="false"');
  });
  it("uses the authoritative remainingMs when the clock is anomalous", () => {
    state.snapshot = { ...running, clockAnomaly: true, remainingMs: 2_000 };
    expect(ring()).toContain("--shell-ring-progress:20%");
  });
});
