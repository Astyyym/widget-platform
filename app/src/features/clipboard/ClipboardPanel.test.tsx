import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClipboardPanel } from "./ClipboardPanel";
import { ClipboardSnapshotStore, type ClipboardBridge } from "./clipboard-store";
import type { ClipboardSnapshot } from "./clipboard-model";

function snapshot(enabled: boolean, entries: ClipboardSnapshot["entries"] = []): ClipboardSnapshot {
  return {
    revision: 1,
    enabled,
    listening: enabled,
    totalEntries: entries.length,
    entries,
    error: null,
  };
}

function bridgeFor(snapshotValue: ClipboardSnapshot): ClipboardBridge {
  return {
    snapshot: async () => snapshotValue,
    setEnabled: async () => snapshotValue,
    copy: async () => undefined,
    deleteEntry: async () => true,
    clearAll: async () => 0,
  };
}

async function renderPanel(snapshotValue: ClipboardSnapshot): Promise<string> {
  const store = new ClipboardSnapshotStore(bridgeFor(snapshotValue));
  await store.refresh();
  return renderToStaticMarkup(createElement(ClipboardPanel, {
    closeButtonRef: createRef<HTMLButtonElement>(),
    store,
    onClose: () => undefined,
  }));
}

describe("ClipboardPanel", () => {
  it("explains that capture is off and shows an empty state", async () => {
    const html = await renderPanel(snapshot(false));
    expect(html).toContain("剪贴板历史");
    expect(html).toContain("显示此模块后会记录新的纯文本");
    expect(html).toContain("还没有剪贴板历史");
    expect(html).not.toContain("正在记录");
    expect(html).not.toContain("正在记录文本");
    expect(html).not.toContain("未启用");
  });

  it("renders text history with copy, delete, and clear-all actions", async () => {
    const html = await renderPanel(snapshot(true, [{
      id: "clip-1",
      text: "合成文本",
      createdAtMs: 1_700_000_000_000,
      sourceAppId: "Editor.exe",
      pinned: false,
      byteLen: 12,
    }]));
    expect(html).toContain("合成文本");
    expect(html).toContain("复制");
    expect(html).toContain("删除");
    expect(html).toContain("清空全部");
    expect(html).toContain("clipboard-history-count");
    expect(html).not.toContain("Pin");
    expect(html).not.toContain("恢复");
    expect(html).not.toContain("开启历史");
  });

  it("does not expose backend error details in the panel", async () => {
    const store = new ClipboardSnapshotStore({
      ...bridgeFor(snapshot(false)),
      snapshot: async () => { throw { code: "storage", detail: "private text" }; },
    });
    await store.refresh();
    const html = renderToStaticMarkup(createElement(ClipboardPanel, {
      closeButtonRef: createRef<HTMLButtonElement>(),
      store,
      onClose: () => undefined,
    }));
    expect(html).toContain("暂不可用");
    expect(html).not.toContain("private text");
  });
});
