import { describe, expect, it } from "vitest";
import { getTodoSummaryPresentation } from "./todo-summary-model";
import type { TodoSnapshot } from "./todo-store";

function snapshot(completed: boolean[]): TodoSnapshot {
  return {
    schemaVersion: 1,
    revision: 4,
    instanceId: "todo-summary-test",
    items: completed.map((isCompleted, index) => ({
      id: `todo-${index}`,
      text: `synthetic task ${index}`,
      completed: isCompleted,
      createdAt: index,
      updatedAt: index,
      priorityOrder: index,
    })),
  };
}

describe("Todo summary presentation", () => {
  it("shows saved completion count and rounded progress beside the check state", () => {
    expect(getTodoSummaryPresentation(snapshot([true, false, false]), 0)).toEqual({
      symbol: "✓",
      symbolVariant: "icon",
      progress: 33,
      previewLabel: "已完成 1 / 3 项",
      accessibleLabel: "待办，已完成 1 / 3",
    });
  });

  it("alternates to the completed-over-total readout without changing its accessible count", () => {
    expect(getTodoSummaryPresentation(snapshot([true, false, false]), 1)).toEqual({
      symbol: "1/3",
      symbolVariant: "readout",
      progress: 33,
      previewLabel: "已完成 1 / 3 项",
      accessibleLabel: "待办，已完成 1 / 3",
    });
  });

  it("uses zero progress for an empty saved list without inventing a completion percentage", () => {
    expect(getTodoSummaryPresentation(snapshot([]), 1)).toEqual({
      symbol: "0/0",
      symbolVariant: "readout",
      progress: 0,
      previewLabel: "暂无待办 · 已完成 0 / 0 项",
      accessibleLabel: "待办，暂无任务，已完成 0 / 0",
    });
  });

  it("shows full progress when every saved task is complete", () => {
    expect(getTodoSummaryPresentation(snapshot([true, true]), 0).progress).toBe(100);
  });

  it("does not show fabricated counts before the first snapshot arrives", () => {
    expect(getTodoSummaryPresentation(null, 1)).toEqual({
      symbol: "✓",
      symbolVariant: "icon",
      progress: undefined,
      previewLabel: "正在读取待办状态",
      accessibleLabel: "待办，正在读取状态",
    });
  });

  it("reports unavailable state rather than zero when the first snapshot fails", () => {
    expect(getTodoSummaryPresentation(null, 1, "failed")).toEqual({
      symbol: "✓",
      symbolVariant: "icon",
      progress: undefined,
      previewLabel: "待办状态暂不可用",
      accessibleLabel: "待办，状态暂不可用",
    });
  });

  it("marks retained counts as last-known when synchronization fails", () => {
    expect(getTodoSummaryPresentation(snapshot([true, false]), 1, "failed")).toEqual({
      symbol: "1/2",
      symbolVariant: "readout",
      progress: 50,
      previewLabel: "同步失败 · 上次已知 1 / 2 项",
      accessibleLabel: "待办，上次已知完成 1 / 2，同步失败",
    });
  });

  it("marks retained counts as last-known while synchronization is in progress", () => {
    expect(getTodoSummaryPresentation(snapshot([true, false]), 1, "syncing")).toEqual({
      symbol: "1/2",
      symbolVariant: "readout",
      progress: 50,
      previewLabel: "正在同步 · 上次已知 1 / 2 项",
      accessibleLabel: "待办，正在同步；上次已知完成 1 / 2",
    });
  });
});
