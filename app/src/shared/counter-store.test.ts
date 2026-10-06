import { describe, expect, it, vi } from "vitest";
import {
  CounterSnapshotStore,
  type CounterBridge,
  type CounterChangedEvent,
  type CounterSnapshot,
} from "./counter-store";

function snapshot(
  revision: number,
  value: number,
  instanceId = "instance-a",
): CounterSnapshot {
  return { schemaVersion: 1, revision, instanceId, value, enabled: true };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("counter snapshot synchronization", () => {
  it("listens before snapshot and applies an early event newer than that snapshot", async () => {
    const store = new CounterSnapshotStore();
    const initial = deferred<unknown>();
    let onEvent: ((event: CounterChangedEvent) => void) | undefined;
    const bridge: CounterBridge = {
      listen: async (handler) => { onEvent = handler; return () => {}; },
      snapshot: () => initial.promise,
    };

    store.connect(bridge, () => { throw new Error("unexpected IPC error"); });
    await flush();
    onEvent?.({ snapshot: snapshot(3, 2) });
    onEvent?.({ snapshot: snapshot(2, 1) });
    initial.resolve(snapshot(2, 1));
    await flush();

    expect(store.getSnapshot()).toEqual(snapshot(3, 2));
  });

  it("accepts a snapshot that arrives before later events and rejects stale or duplicate revisions", async () => {
    const store = new CounterSnapshotStore();
    let onEvent: ((event: CounterChangedEvent) => void) | undefined;
    const bridge: CounterBridge = {
      listen: async (handler) => { onEvent = handler; return () => {}; },
      snapshot: async () => snapshot(4, 3),
    };
    store.connect(bridge, () => { throw new Error("unexpected IPC error"); });
    await flush();

    onEvent?.({ snapshot: snapshot(6, 5) });
    onEvent?.({ snapshot: snapshot(5, 4) });
    onEvent?.({ snapshot: snapshot(6, 5) });

    expect(store.getSnapshot()).toEqual(snapshot(6, 5));
  });

  it("replaces a prior instance only after its authoritative reconnect snapshot", async () => {
    const store = new CounterSnapshotStore();
    store.acceptCommandSnapshot(snapshot(20, 19, "old-instance"));
    let onEvent: ((event: CounterChangedEvent) => void) | undefined;
    const bridge: CounterBridge = {
      listen: async (handler) => { onEvent = handler; return () => {}; },
      snapshot: async () => snapshot(1, 0, "new-instance"),
    };
    store.connect(bridge, () => { throw new Error("unexpected IPC error"); });
    await flush();

    onEvent?.({ snapshot: snapshot(2, 1, "old-instance") });
    onEvent?.({ snapshot: snapshot(2, 1, "new-instance") });

    expect(store.getSnapshot()).toEqual(snapshot(2, 1, "new-instance"));
  });

  it("unlistens on disconnect, ignores late events, and guards pending listener registration", async () => {
    const store = new CounterSnapshotStore();
    const listening = deferred<() => void>();
    let stopCount = 0;
    const stopListening = () => { stopCount += 1; };
    const onEvent = vi.fn();
    const bridge: CounterBridge = {
      listen: async (handler) => { onEvent.mockImplementation(handler); return listening.promise; },
      snapshot: async () => snapshot(1, 0),
    };
    const disconnect = store.connect(bridge, () => { throw new Error("unexpected IPC error"); });
    await flush();
    disconnect();
    listening.resolve(stopListening);
    await flush();
    onEvent({ snapshot: snapshot(2, 1) });

    expect(stopCount).toBe(1);
    expect(store.getSnapshot()).toBeNull();
  });

  it("does not let an older overlapping connection overwrite the active connection", async () => {
    const store = new CounterSnapshotStore();
    const olderSnapshot = deferred<unknown>();
    const oldEvent = vi.fn();
    const oldBridge: CounterBridge = {
      listen: async (handler) => { oldEvent.mockImplementation(handler); return () => {}; },
      snapshot: () => olderSnapshot.promise,
    };
    const newBridge: CounterBridge = {
      listen: async () => () => {},
      snapshot: async () => snapshot(1, 0, "new-connection"),
    };
    store.connect(oldBridge, () => { throw new Error("unexpected IPC error"); });
    await flush();
    store.connect(newBridge, () => { throw new Error("unexpected IPC error"); });
    await flush();
    olderSnapshot.resolve(snapshot(99, 98, "old-connection"));
    await flush();

    expect(store.getSnapshot()).toEqual(snapshot(1, 0, "new-connection"));
  });

  it("reports structured protocol errors and unregisters after snapshot failure", async () => {
    const store = new CounterSnapshotStore();
    let stopCount = 0;
    const stopListening = () => { stopCount += 1; };
    const onError = vi.fn();
    const bridge: CounterBridge = {
      listen: async () => stopListening,
      snapshot: async () => { throw { code: "COUNTER_STATE_UNAVAILABLE", message: "状态不可用。", retryable: true }; },
    };
    store.connect(bridge, onError);
    await flush();

    expect(onError).toHaveBeenCalledWith({
      code: "COUNTER_STATE_UNAVAILABLE",
      message: "状态不可用。",
      retryable: true,
    });
    expect(stopCount).toBe(1);
  });

  it("keeps an edit draft independent from snapshot refreshes", async () => {
    const store = new CounterSnapshotStore();
    let draft = "尚未提交的编辑";
    const onSnapshot = vi.fn((next: CounterSnapshot) => ({ snapshot: next, draft }));
    store.subscribe(() => onSnapshot(store.getSnapshot()!));
    store.acceptCommandSnapshot(snapshot(1, 0));
    store.acceptCommandSnapshot(snapshot(2, 1));

    expect(onSnapshot.mock.results.at(-1)?.value).toEqual({
      snapshot: snapshot(2, 1),
      draft: "尚未提交的编辑",
    });
    expect(draft).toBe("尚未提交的编辑");
  });
});
