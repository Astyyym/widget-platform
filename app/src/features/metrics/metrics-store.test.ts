import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatCpuSummary,
  formatGpuSummary,
  parseMetricsSnapshot,
  shouldSampleMetrics,
} from "./metrics-model";
import { MetricsSnapshotStore } from "./metrics-store";
import type { MetricsBridge } from "./metrics-bridge";

const sample = (revision: number, cpuUsagePercent: number | null = null) => ({
  schemaVersion: 1,
  revision,
  observedAtMs: 1_800_000_000_000 + revision,
  cpuStatus: cpuUsagePercent === null ? "warmingUp" : "available",
  cpuUsagePercent,
  logicalProcessorCount: 8,
  memoryStatus: "available",
  memory: {
    totalBytes: 16 * 1024 ** 3,
    availableBytes: 6 * 1024 ** 3,
    usedBytes: 10 * 1024 ** 3,
    usedPercent: 62.5,
  },
  gpus: [],
});

afterEach(() => vi.useRealTimers());

describe("MetricsSnapshotStore", () => {
  it("only considers enabled CPU or RAM slots visible when the shell is shown", () => {
    expect(shouldSampleMetrics(["cpu"], false)).toBe(true);
    expect(shouldSampleMetrics(["gpu"], false)).toBe(true);
    expect(shouldSampleMetrics(["memory"], false)).toBe(true);
    expect(shouldSampleMetrics(["cpu", "memory"], true)).toBe(false);
    expect(shouldSampleMetrics(["todo", "focus"], false)).toBe(false);
  });

  it("shares one immediate sample and one 2-second loop across consumers", async () => {
    vi.useFakeTimers();
    let revision = 0;
    const bridge: MetricsBridge = {
      sample: vi.fn(async () => sample(++revision, 10)),
    };
    const store = new MetricsSnapshotStore(2_000, () => "test-session");
    const releaseSummary = store.connect(bridge);
    const releasePanel = store.connect(bridge);

    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.sample).toHaveBeenCalledTimes(1);
    expect(store.getState().snapshot?.cpuUsagePercent).toBe(10);
    expect(vi.mocked(bridge.sample).mock.calls[0]?.[0]).toBe("test-session");

    releaseSummary();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(bridge.sample).toHaveBeenCalledTimes(2);

    releasePanel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(bridge.sample).toHaveBeenCalledTimes(2);
    expect(store.getState()).toEqual({ snapshot: null, error: null });
  });

  it("ignores an in-flight result and schedules no more work after the last consumer leaves", async () => {
    vi.useFakeTimers();
    let resolveSample!: (value: unknown) => void;
    const bridge: MetricsBridge = {
      sample: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveSample = resolve;
          }),
      ),
    };
    const store = new MetricsSnapshotStore(2_000, () => "pending-session");
    const release = store.connect(bridge);
    release();
    resolveSample(sample(1, 30));

    await vi.advanceTimersByTimeAsync(10_000);
    expect(bridge.sample).toHaveBeenCalledTimes(1);
    expect(store.getState()).toEqual({ snapshot: null, error: null });
  });

  it("keeps the last good reading with a stale marker when a refresh fails", async () => {
    vi.useFakeTimers();
    const bridge: MetricsBridge = {
      sample: vi
        .fn()
        .mockResolvedValueOnce(sample(1, 20))
        .mockRejectedValueOnce(new Error("untrusted native detail")),
    };
    const store = new MetricsSnapshotStore(2_000, () => "stale-session");
    const release = store.connect(bridge);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(store.getState().snapshot?.revision).toBe(1);
    expect(store.getState().error).toBe("指标读取失败；保留上次成功读数。");
    expect(formatCpuSummary(store.getState().snapshot, store.getState().error)).toBe(
      "更新失败 · CPU 20%",
    );
    release();
  });

  it("keeps the new session when an old request and duplicate release arrive after reconnect", async () => {
    vi.useFakeTimers();
    const pending = new Map<string, (value: unknown) => void>();
    const bridge: MetricsBridge = {
      sample: vi.fn((sessionId) => new Promise((resolve) => pending.set(sessionId, resolve))),
    };
    let session = 0;
    const store = new MetricsSnapshotStore(2_000, () => `session-${++session}`);
    const oldRelease = store.connect(bridge);
    oldRelease();
    const newRelease = store.connect(bridge);
    pending.get("session-2")!(sample(2, 30));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().snapshot?.revision).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
    oldRelease();
    pending.get("session-1")!(sample(1, 10));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().snapshot?.revision).toBe(2);
    expect(store.getState().snapshot?.cpuUsagePercent).toBe(30);
    expect(vi.getTimerCount()).toBe(1);
    newRelease();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(bridge.sample).toHaveBeenCalledTimes(2);
    expect(store.getState()).toEqual({ snapshot: null, error: null });
  });

  it("rejects a zero or contradictory value for a missing CPU sample", () => {
    const missing = sample(1);
    expect(parseMetricsSnapshot(missing).cpuUsagePercent).toBeNull();
    expect(formatCpuSummary(parseMetricsSnapshot(missing), null)).toBe("CPU 采样中");

    expect(() =>
      parseMetricsSnapshot({ ...missing, cpuUsagePercent: 0 }),
    ).toThrow(/CPU 指标状态与数值不一致/);
  });

  it("rejects a partial processor-group value advertised as whole-machine CPU", () => {
    const partial = {
      ...sample(1),
      cpuStatus: "processorGroupLimit",
      logicalProcessorCount: 65,
      cpuUsagePercent: null,
    };
    expect(parseMetricsSnapshot(partial).cpuStatus).toBe("processorGroupLimit");
    expect(() =>
      parseMetricsSnapshot({ ...partial, cpuStatus: "available", cpuUsagePercent: 40 }),
    ).toThrow(/CPU 指标状态与数值不一致/);
  });

  it("parses adapter identity and separate dedicated/shared memory without inventing engine usage", () => {
    const snapshot = parseMetricsSnapshot({
      ...sample(1, 20),
      gpus: [{
        luid: "00000000:0000ABCD",
        name: "Sample Adapter",
        vendorId: 4318,
        deviceId: 104,
        dedicated: { budgetBytes: 8_000, processUsageBytes: 2_000 },
        shared: { budgetBytes: 16_000, processUsageBytes: 3_000 },
        adapterWideDedicatedBytes: 20_000,
        adapterWideSharedBytes: 30_000,
        engineUtilizationPercent: 67.3,
        engineStatus: "available",
      }],
    });
    expect(snapshot.gpus[0]).toMatchObject({
      luid: "00000000:0000ABCD",
      dedicated: { budgetBytes: 8_000, processUsageBytes: 2_000 },
      shared: { budgetBytes: 16_000, processUsageBytes: 3_000 },
      adapterWideDedicatedBytes: 20_000,
      adapterWideSharedBytes: 30_000,
      engineUtilizationPercent: 67.3,
      engineStatus: "available",
    });
    expect(formatGpuSummary(snapshot, null)).toBe("GPU 67%");
  });

  it("rejects engine utilization values when the engine source is unsupported", () => {
    expect(() => parseMetricsSnapshot({
      ...sample(1, 20),
      gpus: [{
        luid: "00000000:00000001",
        name: "Sample Adapter",
        vendorId: 1,
        deviceId: 1,
        dedicated: null,
        shared: null,
        engineUtilizationPercent: 40,
        engineStatus: "unsupported",
      }],
    })).toThrow(/GPU/);
  });

  it("keeps valid DXGI process usage above its current budget", () => {
    const snapshot = parseMetricsSnapshot({
      ...sample(1, 20),
      gpus: [{
        luid: "00000000:00000001",
        name: "Sample Adapter",
        vendorId: 4318,
        deviceId: 1,
        dedicated: { budgetBytes: 8 * 1024 ** 3, processUsageBytes: 9 * 1024 ** 3 },
        shared: null,
        engineUtilizationPercent: null,
        engineStatus: "unsupported",
      }],
    });
    expect(snapshot.gpus[0]?.dedicated?.processUsageBytes).toBe(9 * 1024 ** 3);
    expect(formatGpuSummary(snapshot, null)).toBe("GPU 不可用");
  });
});
