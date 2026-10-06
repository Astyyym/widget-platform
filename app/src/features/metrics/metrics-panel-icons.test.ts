import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalIcon } from "../../shell/LocalIcon";
import { MetricsPanel, type MetricModuleId } from "./MetricsPanel";
import { formatObservedTime, type MetricsSnapshot, type MetricsViewState } from "./metrics-model";

const snapshot: MetricsSnapshot = {
  schemaVersion: 1, revision: 1, observedAtMs: 10_000,
  cpuStatus: "available", cpuUsagePercent: 25, logicalProcessorCount: 8,
  memoryStatus: "available",
  memory: { totalBytes: 16 * 1024 ** 3, availableBytes: 8 * 1024 ** 3,
    usedBytes: 8 * 1024 ** 3, usedPercent: 50 },
  gpus: [{ luid: "synthetic", name: "合成 GPU", vendorId: 1, deviceId: 1,
    dedicated: null, shared: null, adapterWideDedicatedBytes: 2 * 1024 ** 3,
    adapterWideSharedBytes: 1024 ** 3, engineStatus: "available", engineUtilizationPercent: 30 }],
};
function render(moduleId: MetricModuleId, state: MetricsViewState): string {
  return renderToStaticMarkup(createElement(MetricsPanel, {
    moduleId, state, closeButtonRef: createRef<HTMLButtonElement>(), onClose: () => undefined,
  }));
}

describe("Metrics panel local return icon", () => {
  it("uses one decorative 16px return arrow for each module and data quality", () => {
    const arrow = renderToStaticMarkup(createElement(LocalIcon, { name: "x", size: 16 }));
    for (const moduleId of ["cpu", "memory", "gpu"] as const) {
      for (const state of [{ snapshot, error: null }, { snapshot: null, error: null },
        { snapshot, error: "合成刷新失败" }, { snapshot: null, error: "合成不可用" }]) {
        const markup = render(moduleId, state);
        expect(markup).toContain('aria-label="关闭详情" class="shell-panel-close"');
        expect(markup).toContain(arrow);
        expect(markup.match(/class="local-icon"/g)).toHaveLength(1);
        expect(markup).not.toContain("×");
      }
    }
  });
  it("preserves CPU, RAM, GPU readings, stale explanations and observation time", () => {
    const state = { snapshot, error: "合成刷新失败" };
    expect(render("cpu", state)).toContain("25.0%");
    expect(render("memory", state)).toContain("8.0 / 16.0 GiB (50%)");
    expect(render("gpu", state)).toContain("更新失败 · GPU 30%");
    expect(render("gpu", state)).toContain("整卡显存：专用 2.0 GiB · 共享 1.0 GiB");
    for (const moduleId of ["cpu", "memory", "gpu"] as const) {
      const markup = render(moduleId, state);
      expect(markup).toContain("刷新失败；当前显示的是上次成功读数。");
      expect(markup).toContain(formatObservedTime(snapshot.observedAtMs));
    }
    expect(render("cpu", { snapshot: { ...snapshot, cpuStatus: "warmingUp", cpuUsagePercent: null }, error: null })).toContain("正在建立首个差分");
    expect(render("cpu", { snapshot: { ...snapshot, cpuStatus: "processorGroupLimit", cpuUsagePercent: null, logicalProcessorCount: 128 }, error: null })).toContain("多组处理器不可用");
    expect(render("memory", { snapshot: null, error: null })).toContain("物理内存读数不可用");
    expect(render("gpu", { snapshot: null, error: null })).toContain("GPU 不可用");
  });

  it("renders used-value progress bars for CPU, GPU and memory when readings exist", () => {
    const markup = renderToStaticMarkup(createElement(MetricsPanel, {
      moduleId: "memory", state: { snapshot, error: null },
      closeButtonRef: createRef<HTMLButtonElement>(), onClose: () => undefined,
    }));
    expect(markup).toContain('aria-label="内存已用进度"');
    expect(markup).toContain("progress-bar");
  });
});
