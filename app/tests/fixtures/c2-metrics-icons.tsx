import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../../src/shell/shell-frame.css";
import { ICON_SOURCES } from "../../src/shell/LocalIcon";
import { MetricsPanel, type MetricModuleId } from "../../src/features/metrics/MetricsPanel";
import { formatObservedTime, type MetricsSnapshot, type MetricsViewState } from "../../src/features/metrics/metrics-model";

// E1 only: direct synthetic props, no Shell, Store, bridge, IPC or hardware calls.
const snapshot: MetricsSnapshot = {
  schemaVersion: 1, revision: 1, observedAtMs: 10_000,
  cpuStatus: "available", cpuUsagePercent: 25, logicalProcessorCount: 8,
  memoryStatus: "available", memory: { totalBytes: 16 * 1024 ** 3,
    availableBytes: 8 * 1024 ** 3, usedBytes: 8 * 1024 ** 3, usedPercent: 50 },
  gpus: [{ luid: "synthetic", name: "合成 GPU", vendorId: 1, deviceId: 1,
    dedicated: null, shared: null, adapterWideDedicatedBytes: 2 * 1024 ** 3,
    adapterWideSharedBytes: 1024 ** 3, engineStatus: "available", engineUtilizationPercent: 30 }],
};
type Scenario = "available" | "loading" | "unavailable" | "stale" | "warmingUp" | "groupLimit" | "gpuPartial";
let moduleId: MetricModuleId = "cpu", scenario: Scenario = "available", closed = false;
const root = createRoot(document.getElementById("root")!);
const closeButtonRef = createRef<HTMLButtonElement>();
function getState(): MetricsViewState {
  if (scenario === "loading") return { snapshot: null, error: null };
  if (scenario === "unavailable") return { snapshot: { ...snapshot, cpuStatus: "unavailable",
    cpuUsagePercent: null, memoryStatus: "unavailable", memory: null, gpus: [] }, error: null };
  if (scenario === "warmingUp") return { snapshot: { ...snapshot, cpuStatus: "warmingUp", cpuUsagePercent: null }, error: null };
  if (scenario === "groupLimit") return { snapshot: { ...snapshot, cpuStatus: "processorGroupLimit", cpuUsagePercent: null, logicalProcessorCount: 128 }, error: null };
  if (scenario === "gpuPartial") return { snapshot: { ...snapshot, gpus: [{ ...snapshot.gpus[0], engineStatus: "unavailable", engineUtilizationPercent: null, adapterWideDedicatedBytes: null, adapterWideSharedBytes: null }] }, error: null };
  return { snapshot, error: scenario === "stale" ? "合成刷新失败" : null };
}
function close() { closed = true; render(); }
function render() {
  flushSync(() => root.render(
    <div className="shell-stage" style={{ minHeight: "100vh" }}>
      <button id="fixture-focus-start" type="button" style={{ position: "absolute", left: 16, top: 8 }}>合成摘要入口</button>
      {closed ? <p>已返回摘要</p> : <section aria-label="合成指标面板" className="shell-activity-panel edge-top" style={{ top: 60 }}>
        <MetricsPanel moduleId={moduleId} state={getState()} closeButtonRef={closeButtonRef} onClose={close} />
      </section>}
    </div>,
  ));
}
declare global {
  interface Window {
    __resetMetricsIcons: (module: MetricModuleId, value: Scenario) => void;
    __metricsIconState: () => { moduleId: MetricModuleId; scenario: Scenario; closed: boolean; observedTime: string };
    __metricsIconSources: typeof ICON_SOURCES;
  }
}
window.__resetMetricsIcons = (module, value) => { moduleId = module; scenario = value; closed = false; render(); };
window.__metricsIconState = () => ({ moduleId, scenario, closed, observedTime: formatObservedTime(getState().snapshot?.observedAtMs ?? null) });
window.__metricsIconSources = ICON_SOURCES;
render();
