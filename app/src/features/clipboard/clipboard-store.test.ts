import { describe, expect, it } from "vitest";
import {
  ClipboardSnapshotStore,
  type ClipboardBridge,
} from "./clipboard-store";
import type { ClipboardSnapshot } from "./clipboard-model";

function snapshot(revision: number, enabled = false): ClipboardSnapshot {
  return {
    revision,
    enabled,
    listening: enabled,
    totalEntries: 0,
    entries: [],
    error: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => { resolve = done; }), resolve };
}

describe("clipboard snapshot store", () => {
  it("loads the snapshot without enabling native capture", async () => {
    const bridge: ClipboardBridge = {
      snapshot: async () => snapshot(1),
      setEnabled: async () => snapshot(2, true),
      copy: async () => undefined,
      deleteEntry: async () => true,
      clearAll: async () => 0,
    };
    const store = new ClipboardSnapshotStore(bridge);
    await store.refresh();
    expect(store.getState().snapshot).toEqual(snapshot(1));
    expect(store.getState().snapshot?.enabled).toBe(false);
  });

  it("refreshes after enable and ignores an older in-flight response", async () => {
    const first = deferred<ClipboardSnapshot>();
    const second = deferred<ClipboardSnapshot>();
    let calls = 0;
    const bridge: ClipboardBridge = {
      snapshot: () => (calls++ === 0 ? first.promise : second.promise),
      setEnabled: async () => snapshot(3, true),
      copy: async () => undefined,
      deleteEntry: async () => true,
      clearAll: async () => 0,
    };
    const store = new ClipboardSnapshotStore(bridge);
    const oldRefresh = store.refresh();
    const newRefresh = store.refresh();
    second.resolve(snapshot(2));
    await newRefresh;
    first.resolve(snapshot(1));
    await oldRefresh;
    expect(store.getState().snapshot?.revision).toBe(2);
  });

  it("turns invoke failures into a safe user-facing state", async () => {
    const bridge: ClipboardBridge = {
      snapshot: async () => { throw { code: "storage", detail: "private text" }; },
      setEnabled: async () => snapshot(1, true),
      copy: async () => undefined,
      deleteEntry: async () => true,
      clearAll: async () => 0,
    };
    const store = new ClipboardSnapshotStore(bridge);
    await store.refresh();
    expect(store.getState().snapshot).toBeNull();
    expect(store.getState().failure).toBe("剪贴板历史暂不可用");
    expect(store.getState().failure).not.toContain("private text");
  });
});
