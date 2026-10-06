import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalIcon, type IconName } from "../../shell/LocalIcon";
import { TodoPanel } from "./TodoPanel";
import { TodoSnapshotStore } from "./todo-store";

function renderPanel(isFixture = false): string {
  const store = new TodoSnapshotStore();
  store.acceptCommandSnapshot({
    schemaVersion: 1, revision: 1, instanceId: "icon-test",
    items: [
      { id: "first", text: "未完成的样例", completed: false, createdAt: 0, updatedAt: 0, priorityOrder: 0 },
      { id: "second", text: "已完成的样例", completed: true, createdAt: 0, updatedAt: 0, priorityOrder: 1 },
    ],
  });
  return renderToStaticMarkup(createElement(TodoPanel, {
    draft: "", onDraftChange: () => undefined,
    closeButtonRef: createRef<HTMLButtonElement>(), onClose: () => undefined,
    isFixture, snapshotError: null, snapshotSyncStatus: "ready", store,
  }));
}

function icon(name: IconName, size: number): string {
  return renderToStaticMarkup(createElement(LocalIcon, { name, size }));
}

describe("Todo panel local icons", () => {
  it("uses the back icon without losing the accessible return action", () => {
    for (const isFixture of [false, true]) {
      const markup = renderPanel(isFixture).match(/<header>[\s\S]*?<\/header>/)?.[0] ?? "";
      expect(markup).toContain('aria-label="关闭详情"');
      expect(markup).toContain(icon("x", 16));
      expect(markup).not.toContain("×");
    }
  });

  it("uses distinct local glyphs for reorder, completion and deletion while preserving labels", () => {
    const markup = renderPanel();
    expect(markup).toContain(icon("grip-vertical", 16));
    expect(markup).toContain(icon("circle", 20));
    expect(markup).toContain(icon("check", 20));
    expect(markup).toContain(icon("trash-2", 16));
    expect(markup).toContain('aria-checked="false" aria-label="完成：未完成的样例"');
    expect(markup).toContain('aria-checked="true" aria-label="取消完成：已完成的样例"');
    expect(markup).toContain('aria-label="删除：已完成的样例"');
    expect(markup).toContain("使用上下箭头调整顺序");
    expect(markup).toContain("已保存 2 项 · 修订 1");
    for (const glyph of ["⋮⋮", "○", "✓", "×"]) expect(markup).not.toContain(glyph);
  });
});
