import type { Ref } from "react";
import { LocalIcon } from "../../shell/LocalIcon";
import {
  formatGpuSummary,
  formatGiB,
  formatObservedTime,
  type GpuReading,
  type MetricsViewState,
} from "./metrics-model";
import "../../shell/shell-frame.css";

export type MetricModuleId = "cpu" | "gpu" | "memory";

type MetricsPanelProps = {
  moduleId: MetricModuleId;
  state: MetricsViewState;
  closeButtonRef: Ref<HTMLButtonElement>;
  onClose: () => void;
};

export function MetricsPanel({
  moduleId,
  state,
  closeButtonRef,
  onClose,
}: MetricsPanelProps) {
  const snapshot = state.snapshot;
  const isCpu = moduleId === "cpu";
  const isGpu = moduleId === "gpu";
  const title = isCpu ? "CPU" : isGpu ? "GPU" : "内存";
  const availableMemory = snapshot?.memoryStatus === "available" ? snapshot.memory : null;
  const cpuValue =
    snapshot?.cpuStatus === "available" && snapshot.cpuUsagePercent !== null
      ? `${snapshot.cpuUsagePercent.toFixed(1)}%`
      : snapshot?.cpuStatus === "warmingUp"
        ? "正在建立首个差分"
        : snapshot?.cpuStatus === "processorGroupLimit"
          ? "多组处理器不可用"
          : snapshot?.cpuStatus === "unavailable"
            ? "CPU 读数不可用"
            : state.error ?? "正在读取 CPU 指标";
  const memoryValue = availableMemory
    ? `${formatGiB(availableMemory.usedBytes)} / ${formatGiB(availableMemory.totalBytes)} GiB (${availableMemory.usedPercent.toFixed(0)}%)`
    : state.error ?? "物理内存读数不可用";
  const gpuValue = formatGpuSummary(snapshot, state.error);
  const gpu = snapshot?.gpus[0] ?? null;

  return (
    <>
      <header>
        <div>
          <span>系统指标</span>
          <h1>{title}</h1>
        </div>
        <button
          aria-label="关闭详情"
          className="shell-panel-close"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          <LocalIcon name="x" size={16} />
        </button>
      </header>
      {isGpu ? (
        <>
          <p className="metrics-panel-primary">{gpuValue}</p>
          {gpu?.engineStatus === "available" && gpu.engineUtilizationPercent !== null ? (
            <div aria-label="GPU已用进度" className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={gpu.engineUtilizationPercent}><span style={{ width: `${gpu.engineUtilizationPercent}%` }} /></div>
          ) : null}
          {gpu ? <GpuDetails gpu={gpu} /> : null}
        </>
      ) : (
        <>
          <p>{isCpu ? cpuValue : memoryValue}</p>
          {isCpu && snapshot?.cpuStatus === "available" && snapshot.cpuUsagePercent !== null ? (
            <div aria-label="CPU已用进度" className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={snapshot.cpuUsagePercent}><span style={{ width: `${snapshot.cpuUsagePercent}%` }} /></div>
          ) : null}
          {!isCpu && availableMemory ? (
            <div aria-label="内存已用进度" className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={availableMemory.usedPercent}><span style={{ width: `${availableMemory.usedPercent}%` }} /></div>
          ) : null}
        </>
      )}
      {state.error && snapshot ? (
        <p role="status">刷新失败；当前显示的是上次成功读数。</p>
      ) : null}
      {!isGpu ? (
        <p>
          {isCpu
            ? snapshot?.cpuStatus === "processorGroupLimit"
              ? "Windows 当前计时 API 不能提供跨 processor group 的全机 CPU 值。"
              : `Windows 系统 CPU 差分 · ${snapshot?.logicalProcessorCount ?? "未知"} 个逻辑处理器 · 约 2 秒采样`
            : "物理内存口径：总量减可用量；不是本应用进程占用。"}
        </p>
      ) : null}
      <footer>
        <span aria-hidden="true" />
        更新时间：{formatObservedTime(snapshot?.observedAtMs ?? null)}
      </footer>
    </>
  );
}

function GpuDetails({ gpu }: { gpu: GpuReading }) {
  const dedicated =
    gpu.adapterWideDedicatedBytes === null
      ? "不可用"
      : `${formatGiB(gpu.adapterWideDedicatedBytes)} GiB`;
  const shared =
    gpu.adapterWideSharedBytes === null
      ? "不可用"
      : `${formatGiB(gpu.adapterWideSharedBytes)} GiB`;

  return (
    <div className="metrics-panel-gpu-details">
      <p>{gpu.name}</p>
      <p>整卡显存：专用 {dedicated} · 共享 {shared}</p>
    </div>
  );
}
