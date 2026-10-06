import { describe, expect, it, vi } from "vitest";
import {
  parseTimerError,
  parseTimerSnapshot,
  TimerSnapshotStore,
  type TimerBridge,
  type TimerChangedEvent,
  type TimerSnapshot,
} from "./timer-store";

function snapshot(revision: number, instanceId = "timer-instance"): TimerSnapshot {
  return {
    schemaVersion: 1,
    revision,
    instanceId,
    phase: "focus",
    state: revision >= 2 ? "running" : "idle",
    durationMs: 1_500_000,
    remainingMs: revision >= 2 ? 1_499_000 : 1_500_000,
    deadlineUtc: revision >= 2 ? 2_500_000 : null,
    generation: revision >= 2 ? 1 : 0,
    completionId: null,
    clockAnomaly: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("timer snapshot synchronization", () => {
  it("listens before snapshot and keeps the newest early event", async () => {
    const store = new TimerSnapshotStore();
    const initial = deferred<unknown>();
    let onEvent: ((event: TimerChangedEvent) => void) | undefined;
    const bridge: Pick<TimerBridge, "listen" | "snapshot"> = {
      listen: async (handler) => { onEvent = handler; return () => {}; },
      snapshot: () => initial.promise,
    };
    store.connect(bridge, () => { throw new Error("unexpected error"); });
    await flush();
    onEvent?.({ snapshot: snapshot(3) });
    onEvent?.({ snapshot: snapshot(2) });
    initial.resolve(snapshot(2));
    await flush();
    expect(store.getSnapshot()).toEqual(snapshot(3));
  });

  it("rejects stale and old-instance events", async () => {
    const store = new TimerSnapshotStore();
    let onEvent: ((event: TimerChangedEvent) => void) | undefined;
    const bridge: Pick<TimerBridge, "listen" | "snapshot"> = {
      listen: async (handler) => { onEvent = handler; return () => {}; },
      snapshot: async () => snapshot(2),
    };
    store.connect(bridge, () => { throw new Error("unexpected error"); });
    await flush();
    onEvent?.({ snapshot: snapshot(1) });
    onEvent?.({ snapshot: snapshot(4) });
    onEvent?.({ snapshot: snapshot(5, "old-instance") });
    expect(store.getSnapshot()).toEqual(snapshot(4));
  });

  it("guards a late listener from an older connection", async () => {
    const store = new TimerSnapshotStore();
    const oldSnapshot = deferred<unknown>();
    const oldEvent = vi.fn();
    const oldBridge: Pick<TimerBridge, "listen" | "snapshot"> = {
      listen: async (handler) => { oldEvent.mockImplementation(handler); return () => {}; },
      snapshot: () => oldSnapshot.promise,
    };
    const newBridge: Pick<TimerBridge, "listen" | "snapshot"> = {
      listen: async () => () => {},
      snapshot: async () => snapshot(1, "new-instance"),
    };
    store.connect(oldBridge, () => { throw new Error("unexpected error"); });
    await flush();
    store.connect(newBridge, () => { throw new Error("unexpected error"); });
    await flush();
    oldSnapshot.resolve(snapshot(99, "old-instance"));
    await flush();
    expect(store.getSnapshot()).toEqual(snapshot(1, "new-instance"));
  });

  it("rejects malformed snapshots and parses structured errors", () => {
    expect(() => parseTimerSnapshot({ schemaVersion: 1, state: "running" })).toThrow();
    expect(parseTimerError({ code: "x", message: "失败", retryable: false })).toEqual({
      code: "x", message: "失败", retryable: false,
    });
  });
});
