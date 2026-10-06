import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalIcon } from "../../shell/LocalIcon";
import { ClipboardPanel } from "./ClipboardPanel";
import { ClipboardSnapshotStore, type ClipboardBridge } from "./clipboard-store";
import type { ClipboardSnapshot } from "./clipboard-model";

const text = "合成测试文本 <b>不是HTML</b>";
const snapshot: ClipboardSnapshot = {
  revision: 1, enabled: false, listening: false, totalEntries: 1, error: null,
  entries: [{ id: "clip-1", text, createdAtMs: 10_000, sourceAppId: "synthetic-app", pinned: false, byteLen: new TextEncoder().encode(text).length }],
};
function makeStore(data: ClipboardSnapshot | null) {
  const rejected = () => Promise.reject(new Error("Unexpected synthetic mutation"));
  const bridge: ClipboardBridge = {
    snapshot: data ? async () => data : rejected,
    setEnabled: rejected, copy: rejected, deleteEntry: rejected, clearAll: rejected,
  };
  return new ClipboardSnapshotStore(bridge);
}

describe("Clipboard panel local return icon", () => {
  it("keeps one decorative 16px arrow and existing text actions across empty/history/failure states", async () => {
    const arrow = renderToStaticMarkup(createElement(LocalIcon, { name: "x", size: 16 }));
    const initial = makeStore(snapshot);
    const stores = [initial];
    for (const data of [snapshot, { ...snapshot, entries: [], totalEntries: 0 },
      { ...snapshot, error: "synthetic-listener-failure" }, null]) {
      const store = makeStore(data);
      await store.refresh();
      stores.push(store);
    }
    for (const store of stores) {
      const markup = renderToStaticMarkup(createElement(ClipboardPanel, {
        store, closeButtonRef: createRef<HTMLButtonElement>(), onClose: () => undefined,
      }));
      expect(markup).toContain('aria-label="关闭详情" class="shell-panel-close"');
      expect(markup).toContain(arrow);
      expect(markup.match(/class="local-icon"/g)).toHaveLength(1);
      expect(markup).not.toContain("×");
      expect(markup).toContain("清空全部");
      if (store.getState().snapshot?.entries.length) {
        expect(markup).toContain('type="button">复制</button>');
        expect(markup).toContain('type="button">删除</button>');
        expect(markup).toContain("&lt;b&gt;不是HTML&lt;/b&gt;");
        expect(markup).toContain("1 条历史");
      } else expect(markup).toContain("还没有剪贴板历史");
      if (store.getState().failure) expect(markup).toContain('role="alert"');
      if (store.getState().snapshot?.error) expect(markup).toContain("新的文本不会写入历史");
    }
  });
});
