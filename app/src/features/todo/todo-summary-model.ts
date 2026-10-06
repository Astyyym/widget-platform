import type { TodoSnapshot } from "./todo-store";

export type TodoSummaryPresentation = {
  symbol: string;
  symbolVariant: "icon" | "readout";
  progress: number | undefined;
  previewLabel: string;
  accessibleLabel: string;
};

export function getTodoSummaryPresentation(
  snapshot: TodoSnapshot | null,
  displayPhase: number,
  synchronizationStatus: "idle" | "syncing" | "ready" | "failed" = "ready",
): TodoSummaryPresentation {
  if (!snapshot) {
    return synchronizationStatus === "failed"
      ? {
          symbol: "✓",
          symbolVariant: "icon",
          progress: undefined,
          previewLabel: "待办状态暂不可用",
          accessibleLabel: "待办，状态暂不可用",
        }
      : {
          symbol: "✓",
          symbolVariant: "icon",
          progress: undefined,
          previewLabel: "正在读取待办状态",
          accessibleLabel: "待办，正在读取状态",
        };
  }

  const total = snapshot.items.length;
  const completed = snapshot.items.reduce(
    (count, item) => count + Number(item.completed),
    0,
  );
  const showReadout = Math.abs(displayPhase % 2) === 1;
  const symbolVariant = showReadout ? "readout" : "icon";
  const symbol = showReadout ? `${completed}/${total}` : "✓";
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100);

  if (synchronizationStatus === "syncing" || synchronizationStatus === "idle") {
    const statusLabel = synchronizationStatus === "syncing" ? "正在同步" : "尚未同步";
    return {
      symbol,
      symbolVariant,
      progress,
      previewLabel: `${statusLabel} · 上次已知 ${completed} / ${total} 项`,
      accessibleLabel: `待办，${statusLabel}；上次已知完成 ${completed} / ${total}`,
    };
  }

  if (synchronizationStatus === "failed") {
    return {
      symbol,
      symbolVariant,
      progress,
      previewLabel: `同步失败 · 上次已知 ${completed} / ${total} 项`,
      accessibleLabel: `待办，上次已知完成 ${completed} / ${total}，同步失败`,
    };
  }

  return {
    symbol,
    symbolVariant,
    progress,
    previewLabel:
      total === 0
        ? "暂无待办 · 已完成 0 / 0 项"
        : `已完成 ${completed} / ${total} 项`,
    accessibleLabel:
      total === 0
        ? "待办，暂无任务，已完成 0 / 0"
        : `待办，已完成 ${completed} / ${total}`,
  };
}
