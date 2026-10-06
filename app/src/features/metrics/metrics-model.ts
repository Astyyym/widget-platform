export type CpuStatus =
  | "warmingUp"
  | "available"
  | "processorGroupLimit"
  | "unavailable";

export type MemoryStatus = "available" | "unavailable";

export type MemoryReading = {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usedPercent: number;
};

export type GpuMemoryReading = {
  budgetBytes: number;
  processUsageBytes: number;
};

export type GpuEngineStatus = "available" | "unsupported" | "unavailable";

export type GpuReading = {
  luid: string;
  name: string;
  vendorId: number;
  deviceId: number;
  dedicated: GpuMemoryReading | null;
  shared: GpuMemoryReading | null;
  adapterWideDedicatedBytes: number | null;
  adapterWideSharedBytes: number | null;
  engineUtilizationPercent: number | null;
  engineStatus: GpuEngineStatus;
};

export type MetricsSnapshot = {
  schemaVersion: 1;
  revision: number;
  observedAtMs: number;
  cpuStatus: CpuStatus;
  cpuUsagePercent: number | null;
  logicalProcessorCount: number | null;
  memoryStatus: MemoryStatus;
  memory: MemoryReading | null;
  gpus: GpuReading[];
};

export type MetricsViewState = {
  snapshot: MetricsSnapshot | null;
  error: string | null;
};

export type MetricsError = {
  code: string;
  message: string;
  retryable: boolean;
};

export function shouldSampleMetrics(
  contentIds: readonly string[],
  settingsOpen: boolean,
): boolean {
  return (
    !settingsOpen &&
    contentIds.some((id) => id === "cpu" || id === "gpu" || id === "memory")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function parseMetricsSnapshot(value: unknown): MetricsSnapshot {
  if (!isRecord(value)) {
    throw metricError("INVALID_METRICS_SNAPSHOT", "指标快照格式无效。", false);
  }

  const cpuStatuses: readonly CpuStatus[] = [
    "warmingUp",
    "available",
    "processorGroupLimit",
    "unavailable",
  ];
  const engineStatuses: readonly GpuEngineStatus[] = [
    "available",
    "unsupported",
    "unavailable",
  ];
  const candidate = value;
  if (
    candidate.schemaVersion !== 1 ||
    !isSafeNonNegativeInteger(candidate.revision) ||
    !isSafeNonNegativeInteger(candidate.observedAtMs) ||
    !cpuStatuses.includes(candidate.cpuStatus as CpuStatus) ||
    (candidate.cpuUsagePercent !== null && !isPercent(candidate.cpuUsagePercent)) ||
    (candidate.logicalProcessorCount !== null &&
      (!isSafeNonNegativeInteger(candidate.logicalProcessorCount) ||
        candidate.logicalProcessorCount === 0)) ||
    !["available", "unavailable"].includes(candidate.memoryStatus as string)
  ) {
    throw metricError("INVALID_METRICS_SNAPSHOT", "指标快照字段不符合协议。", false);
  }

  const cpuStatus = candidate.cpuStatus as CpuStatus;
  const cpuUsagePercent = candidate.cpuUsagePercent as number | null;
  const logicalProcessorCount = candidate.logicalProcessorCount as number | null;
  if (
    (cpuStatus === "available" &&
      (cpuUsagePercent === null || logicalProcessorCount === null || logicalProcessorCount > 64)) ||
    (cpuStatus !== "available" && cpuUsagePercent !== null) ||
    (cpuStatus === "processorGroupLimit" &&
      (logicalProcessorCount === null || logicalProcessorCount <= 64))
  ) {
    throw metricError("INVALID_METRICS_SNAPSHOT", "CPU 指标状态与数值不一致。", false);
  }

  let memory: MemoryReading | null = null;
  if (candidate.memoryStatus === "available") {
    if (!isRecord(candidate.memory)) {
      throw metricError("INVALID_METRICS_SNAPSHOT", "物理内存读数缺失。", false);
    }
    const rawMemory = candidate.memory;
    if (
      !isSafeNonNegativeInteger(rawMemory.totalBytes) ||
      rawMemory.totalBytes === 0 ||
      !isSafeNonNegativeInteger(rawMemory.availableBytes) ||
      rawMemory.availableBytes > rawMemory.totalBytes ||
      !isSafeNonNegativeInteger(rawMemory.usedBytes) ||
      rawMemory.usedBytes !== rawMemory.totalBytes - rawMemory.availableBytes ||
      !isPercent(rawMemory.usedPercent)
    ) {
      throw metricError("INVALID_METRICS_SNAPSHOT", "物理内存读数无效。", false);
    }
    const expectedPercent = rawMemory.usedBytes * 100 / rawMemory.totalBytes;
    if (Math.abs((rawMemory.usedPercent as number) - expectedPercent) > 0.0001) {
      throw metricError("INVALID_METRICS_SNAPSHOT", "物理内存百分比与字节数不一致。", false);
    }
    memory = {
      totalBytes: rawMemory.totalBytes,
      availableBytes: rawMemory.availableBytes,
      usedBytes: rawMemory.usedBytes,
      usedPercent: rawMemory.usedPercent as number,
    };
  } else if (candidate.memory !== null) {
    throw metricError("INVALID_METRICS_SNAPSHOT", "不可用的内存状态不能包含数值。", false);
  }

  if (!Array.isArray(candidate.gpus) || candidate.gpus.length > 32) {
    throw metricError("INVALID_METRICS_SNAPSHOT", "GPU 列表格式无效。", false);
  }
  const gpus = candidate.gpus.map((value) => {
    if (!isRecord(value)) {
      throw metricError("INVALID_METRICS_SNAPSHOT", "GPU 条目格式无效。", false);
    }
    if (
      typeof value.luid !== "string" ||
      value.luid.length === 0 ||
      value.luid.length > 40 ||
      typeof value.name !== "string" ||
      value.name.length === 0 ||
      value.name.length > 128 ||
      !isSafeNonNegativeInteger(value.vendorId) ||
      value.vendorId > 0xffff ||
      !isSafeNonNegativeInteger(value.deviceId) ||
      value.deviceId > 0xffff ||
      !engineStatuses.includes(value.engineStatus as GpuEngineStatus) ||
      (value.engineUtilizationPercent !== null && !isPercent(value.engineUtilizationPercent))
    ) {
      throw metricError("INVALID_METRICS_SNAPSHOT", "GPU 条目字段无效。", false);
    }
    if (
      value.engineStatus !== "available" &&
      value.engineUtilizationPercent !== null
    ) {
      throw metricError("INVALID_METRICS_SNAPSHOT", "GPU 引擎不可用时不能包含占用率。", false);
    }
    const parseMemory = (memory: unknown): GpuMemoryReading | null => {
      if (memory === null) return null;
      if (!isRecord(memory)) {
        throw metricError("INVALID_METRICS_SNAPSHOT", "GPU 显存条目格式无效。", false);
      }
      if (
        !isSafeNonNegativeInteger(memory.budgetBytes) ||
        !isSafeNonNegativeInteger(memory.processUsageBytes) ||
        (memory.budgetBytes === 0 && memory.processUsageBytes === 0)
      ) {
        throw metricError("INVALID_METRICS_SNAPSHOT", "GPU 显存读数无效。", false);
      }
      return {
        budgetBytes: memory.budgetBytes,
        processUsageBytes: memory.processUsageBytes,
      };
    };
    return {
      luid: value.luid,
      name: value.name,
      vendorId: value.vendorId,
      deviceId: value.deviceId,
      dedicated: parseMemory(value.dedicated),
      shared: parseMemory(value.shared),
      adapterWideDedicatedBytes:
        value.adapterWideDedicatedBytes === null || value.adapterWideDedicatedBytes === undefined
          ? null
          : isSafeNonNegativeInteger(value.adapterWideDedicatedBytes)
            ? value.adapterWideDedicatedBytes
            : (() => {
                throw metricError("INVALID_METRICS_SNAPSHOT", "GPU 整卡显存读数无效。", false);
              })(),
      adapterWideSharedBytes:
        value.adapterWideSharedBytes === null || value.adapterWideSharedBytes === undefined
          ? null
          : isSafeNonNegativeInteger(value.adapterWideSharedBytes)
            ? value.adapterWideSharedBytes
            : (() => {
                throw metricError("INVALID_METRICS_SNAPSHOT", "GPU 整卡显存读数无效。", false);
              })(),
      engineUtilizationPercent: value.engineUtilizationPercent,
      engineStatus: value.engineStatus as GpuEngineStatus,
    };
  });

  return {
    schemaVersion: 1,
    revision: candidate.revision,
    observedAtMs: candidate.observedAtMs,
    cpuStatus,
    cpuUsagePercent,
    logicalProcessorCount,
    memoryStatus: candidate.memoryStatus as MemoryStatus,
    memory,
    gpus,
  };
}

export function formatCpuSummary(
  snapshot: MetricsSnapshot | null,
  error: string | null,
): string {
  if (!snapshot) return error ?? "等待 CPU 首次采样";
  const reading =
    snapshot.cpuStatus === "available" && snapshot.cpuUsagePercent !== null
      ? `CPU ${snapshot.cpuUsagePercent.toFixed(0)}%`
      : snapshot.cpuStatus === "warmingUp"
        ? "CPU 采样中"
        : snapshot.cpuStatus === "processorGroupLimit"
          ? "CPU 暂不支持多组处理器"
          : "CPU 不可用";
  return error ? `更新失败 · ${reading}` : reading;
}

export function formatMemorySummary(
  snapshot: MetricsSnapshot | null,
  error: string | null,
): string {
  const memory = snapshot?.memoryStatus === "available" ? snapshot.memory : null;
  if (!memory) return error ?? "内存不可用";
  const reading = `${formatGiB(memory.usedBytes)} / ${formatGiB(memory.totalBytes)} GiB`;
  return error ? `更新失败 · ${reading}` : reading;
}

export function formatGpuSummary(
  snapshot: MetricsSnapshot | null,
  error: string | null,
): string {
  const gpu = snapshot?.gpus[0];
  if (!gpu) return error ?? "GPU 不可用";
  const reading =
    gpu.engineStatus === "available" && gpu.engineUtilizationPercent !== null
      ? `GPU ${gpu.engineUtilizationPercent.toFixed(0)}%`
      : "GPU 不可用";
  return error ? `更新失败 · ${reading}` : reading;
}

export function formatGiB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

export function formatObservedTime(observedAtMs: number | null): string {
  if (observedAtMs === null) return "尚无采样时间";
  const date = new Date(observedAtMs);
  return Number.isNaN(date.getTime())
    ? "采样时间不可用"
    : date.toLocaleTimeString();
}

function metricError(code: string, message: string, retryable: boolean): MetricsError {
  return { code, message, retryable };
}
