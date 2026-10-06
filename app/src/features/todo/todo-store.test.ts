import { describe, expect, it, vi } from "vitest";
import {
  parseTodoError,
  parseTodoSnapshot,
  TodoSnapshotStore,
  type TodoBridge,
  type TodoChangedEvent,
  type TodoSnapshot,
} from "./todo-store";

function snapshot(revision: number, texts: string[], instanceId = "todo-instance"): TodoSnapshot {
  return {
    schemaVersion: 1,
    revision,
    instanceId,
    items: texts.map((text, index) => ({
      id: `todo-${index}`,
      text,
      completed: false,
      createdAt: index,
      updatedAt: index,
      priorityOrder: index,
    })),
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

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("todo snapshot synchronization", () => {
  it("listens before snapshot and applies the newest early event", async () => {
    const store = new TodoSnapshotStore();
    const initial = deferred<unknown>();
    let onEvent: ((event: TodoChangedEvent) => void) | undefined;
    const bridge: Pick<TodoBridge, "listen" | "snapshot"> = {
      listen: async (handler) => { onEvent = handler; return () => {}; },
      snapshot: () => initial.promise,
    };
    store.connect(bridge, () => { throw new Error("unexpected error"); });
    await flush();

    onEvent?.({ snapshot: snapshot(3, ["new"]) });
    onEvent?.({ snapshot: snapshot(2, ["old"]) });
    initial.resolve(snapshot(2, ["old"]));
    await flush();

    expect(store.getSnapshot()).toEqual(snapshot(3, ["new"]));
  });

  it("rejects stale events and old instances after synchronization", async () => {
    const store = new TodoSnapshotStore();
    let onEvent: ((event: TodoChangedEvent) => void) | undefined;
    const bridge: Pick<TodoBridge, "listen" | "snapshot"> = {
      listen: async (handler) => { onEvent = handler; return () => {}; },
      snapshot: async () => snapshot(4, ["saved"]),
    };
    store.connect(bridge, () => { throw new Error("unexpected error"); });
    await flush();
    onEvent?.({ snapshot: snapshot(3, ["stale"]) });
    onEvent?.({ snapshot: snapshot(5, ["newer"]) });
    onEvent?.({ snapshot: snapshot(6, ["old-instance"], "other") });
    expect(store.getSnapshot()).toEqual(snapshot(5, ["newer"]));
  });

  it("guards overlapping connections and disconnects late listeners", async () => {
    const store = new TodoSnapshotStore();
    const oldSnapshot = deferred<unknown>();
    const oldEvent = vi.fn();
    const oldBridge: Pick<TodoBridge, "listen" | "snapshot"> = {
      listen: async (handler) => { oldEvent.mockImplementation(handler); return () => {}; },
      snapshot: () => oldSnapshot.promise,
    };
    const newBridge: Pick<TodoBridge, "listen" | "snapshot"> = {
      listen: async () => () => {},
      snapshot: async () => snapshot(1, ["current"], "new-instance"),
    };
    store.connect(oldBridge, () => { throw new Error("unexpected error"); });
    await flush();
    store.connect(newBridge, () => { throw new Error("unexpected error"); });
    await flush();
    oldSnapshot.resolve(snapshot(99, ["old"], "old-instance"));
    await flush();
    expect(store.getSnapshot()).toEqual(snapshot(1, ["current"], "new-instance"));
  });

  it("retries a retryable connection failure and refreshes the retained snapshot", async () => {
    vi.useFakeTimers();
    try {
      const store = new TodoSnapshotStore();
      store.acceptCommandSnapshot(snapshot(1, ["last known"]));
      const retrySnapshot = deferred<unknown>();
      let listenCalls = 0;
      let snapshotCalls = 0;
      const bridge: Pick<TodoBridge, "listen" | "snapshot"> = {
        listen: async () => {
          listenCalls += 1;
          return () => {};
        },
        snapshot: async () => {
          snapshotCalls += 1;
          if (snapshotCalls === 1) throw new Error("temporary connection failure");
          return retrySnapshot.promise;
        },
      };
      const onError = vi.fn();

      const disconnect = store.connect(bridge, onError);
      await flushMicrotasks();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(store.getSyncStatus()).toBe("failed");
      expect(store.getSnapshot()).toEqual(snapshot(1, ["last known"]));

      await vi.advanceTimersByTimeAsync(5_000);
      await flushMicrotasks();
      expect(listenCalls).toBe(2);
      expect(snapshotCalls).toBe(2);
      expect(store.getSyncStatus()).toBe("syncing");
      expect(store.getSnapshot()).toEqual(snapshot(1, ["last known"]));

      retrySnapshot.resolve(snapshot(2, ["refreshed"]));
      await flushMicrotasks();
      expect(store.getSnapshot()).toEqual(snapshot(2, ["refreshed"]));
      expect(store.getSyncStatus()).toBe("ready");
      disconnect();
      expect(store.getSyncStatus()).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("parses structured errors and rejects malformed snapshots", () => {
    expect(parseTodoError({ code: "x", message: "失败", retryable: false })).toEqual({
      code: "x",
      message: "失败",
      retryable: false,
    });
    expect(() => parseTodoSnapshot({ schemaVersion: 1, revision: 0, instanceId: "x", items: [{ id: "bad" }] })).toThrow();
  });
});
