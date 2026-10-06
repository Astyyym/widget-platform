import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ShellFrame } from "./ShellFrame";
import { SettingsPanel } from "../settings/SettingsPanel";
import { DEFAULT_WIDGET_SETTINGS, type WidgetSettings } from "../settings/settings-model";
import type { TimerSnapshot, TimerStateKind } from "../features/timer/timer-store";

const seam = vi.hoisted(() => ({ snapshot: null as TimerSnapshot | null, updates: [] as unknown[] }));
// E1 actual ShellFrame settings handler; effects/native providers are not mounted.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useRef: <T,>(initial: T) => ({ current: initial }),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
  useState: <T,>(initial: T | (() => T)) => {
    let value = typeof initial === "function" ? (initial as () => T)() : initial;
    if (typeof value === "object" && value !== null && "hoveredModuleId" in value) {
      value = { ...value, settingsOpen: true };
    }
    return [value, (next: T | ((current: T) => T)) => {
      value = typeof next === "function" ? (next as (current: T) => T)(value) : next;
      seam.updates.push(value);
    }];
  },
}));
vi.mock("../features/timer/timer-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("../features/timer/timer-store")>(),
  TimerSnapshotStore: class { getSnapshot() { return seam.snapshot; } },
}));

type Props = { children?: ReactNode; onChange?: (settings: WidgetSettings) => Promise<boolean> };
function settingsProps(node: ReactNode): Props | undefined {
  if (Array.isArray(node)) return node.map(settingsProps).find(Boolean);
  if (!isValidElement<Props>(node)) return undefined;
  if (node.type === SettingsPanel) return node.props;
  return settingsProps(node.props.children);
}
function snapshot(state: TimerStateKind): TimerSnapshot {
  return { schemaVersion: 1, revision: 1, instanceId: "timer-disable-test", phase: "focus", state,
    durationMs: 60000, remainingMs: 60000, deadlineUtc: state === "running" ? Date.now() + 60000 : null,
    generation: 1, completionId: state === "completed" ? "completion-test" : null, clockAnomaly: false };
}
const initial: WidgetSettings = { ...DEFAULT_WIDGET_SETTINGS, enabledContentIds: ["todo", "focus"] };
function render(persistSettings: (settings: WidgetSettings) => Promise<void>) {
  const props = settingsProps(ShellFrame({ initialSettings: initial, persistSettings }));
  if (!props?.onChange) throw new Error("Actual settings handler not found");
  return props.onChange;
}
beforeEach(() => {
  vi.clearAllMocks(); seam.snapshot = null; seam.updates = [];
  vi.stubGlobal("window", { innerWidth: 440, innerHeight: 520, devicePixelRatio: 1 });
  vi.stubGlobal("document", { hidden: false });
});
afterEach(() => vi.unstubAllGlobals());

it.each(["running", "paused", null] as const)("does not persist Focus removal while Timer is %s", async (state) => {
  seam.snapshot = state === null ? null : snapshot(state);
  const persist = vi.fn(async () => undefined);
  const change = render(persist);
  expect(await change({ ...initial, enabledContentIds: ["todo"] })).toBe(false);
  expect(persist).not.toHaveBeenCalled();
  expect(seam.updates).toContain("failed");
  expect(seam.updates.some((value) => typeof value === "string" && value.includes("计时"))).toBe(true);
  expect(seam.updates.some((value) => typeof value === "object" && value !== null && "enabledContentIds" in value)).toBe(false);
});

it.each(["idle", "completed"] as const)("persists Focus removal after Timer is %s", async (state) => {
  seam.snapshot = snapshot(state);
  const persist = vi.fn(async () => undefined);
  const next = { ...initial, enabledContentIds: ["todo"] as WidgetSettings["enabledContentIds"] };
  expect(await render(persist)(next)).toBe(true);
  expect(persist).toHaveBeenCalledExactlyOnceWith(next);
});

it("still persists unrelated settings while Timer runs", async () => {
  seam.snapshot = snapshot("running");
  const persist = vi.fn(async () => undefined);
  const next = { ...initial, edgeOffset: 0.75 };
  expect(await render(persist)(next)).toBe(true);
  expect(persist).toHaveBeenCalledExactlyOnceWith(next);
});

it("uses the current store snapshot rather than an earlier render snapshot", async () => {
  seam.snapshot = snapshot("idle");
  const persist = vi.fn(async () => undefined);
  const change = render(persist);
  seam.snapshot = snapshot("running");
  expect(await change({ ...initial, enabledContentIds: ["todo"] })).toBe(false);
  expect(persist).not.toHaveBeenCalled();
  seam.snapshot = snapshot("idle");
  expect(await change({ ...initial, enabledContentIds: ["todo"] })).toBe(true);
  expect(persist).toHaveBeenCalledTimes(1);
});
