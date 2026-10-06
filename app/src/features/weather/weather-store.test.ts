import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WeatherBridge } from "./weather-bridge";
import {
  WeatherSnapshotStore,
  shouldConnectWeather,
} from "./weather-store";
import type { WeatherLocationSettings } from "../../settings/settings-model";

const now = 1_790_557_200_000;
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/weather/fresh-celsius.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;
const location: WeatherLocationSettings = {
  name: "测试城市",
  latitude: 30.2741,
  longitude: 120.1551,
  timezone: "Asia/Shanghai",
  temperatureUnit: "celsius",
};

function makeBridge(): WeatherBridge & {
  read: ReturnType<typeof vi.fn<(location: WeatherLocationSettings) => Promise<unknown>>>;
  cancel: ReturnType<typeof vi.fn<(location: WeatherLocationSettings) => Promise<boolean>>>;
} {
  return {
    read: vi.fn<(location: WeatherLocationSettings) => Promise<unknown>>(),
    cancel: vi.fn<(location: WeatherLocationSettings) => Promise<boolean>>().mockResolvedValue(false),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("weather snapshot store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    { condition: "visible configured module", input: {}, expected: true },
    { condition: "fixture mode", input: { isFixture: true }, expected: false },
    { condition: "hidden document", input: { documentVisible: false }, expected: false },
    { condition: "disabled module", input: { moduleEnabled: false }, expected: false },
    { condition: "hidden widget", input: { hidden: true }, expected: true },
    { condition: "settings open", input: { settingsOpen: true }, expected: false },
    { condition: "missing location", input: { location: null }, expected: false },
  ])("connects only for a $condition", ({ input, expected }) => {
    expect(shouldConnectWeather({
      isFixture: false,
      documentVisible: true,
      moduleEnabled: true,
      hidden: false,
      settingsOpen: false,
      location,
      ...input,
    })).toBe(expected);
  });

  it("requests once for duplicate consumers and waits for the backend refresh delay", async () => {
    const bridge = makeBridge();
    bridge.read.mockResolvedValue(fixture);
    const store = new WeatherSnapshotStore();

    const disconnectA = store.connect(bridge, location);
    const disconnectB = store.connect(bridge, location);
    await flushPromises();

    expect(bridge.read).toHaveBeenCalledOnce();
    expect(store.getState().weather.quality).toBe("fresh");
    await vi.advanceTimersByTimeAsync(1_799_999);
    expect(bridge.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(bridge.read).toHaveBeenCalledTimes(2);

    disconnectA();
    disconnectB();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("accepts stale last-good data and preserves the provider observation time", async () => {
    const bridge = makeBridge();
    const stale = structuredClone(fixture) as Record<string, unknown>;
    stale.quality = "stale";
    stale.failureReason = "network";
    stale.lastAttemptAtMs = now + 60_000;
    bridge.read.mockResolvedValue(stale);
    const store = new WeatherSnapshotStore();

    const disconnect = store.connect(bridge, location);
    await flushPromises();

    expect(store.getState().weather).toMatchObject({
      quality: "stale",
      failureReason: "network",
      snapshot: { observedAtMs: now },
    });
    disconnect();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("cancels an in-flight request after the last consumer leaves", async () => {
    const bridge = makeBridge();
    const pending = deferred<unknown>();
    bridge.read.mockReturnValue(pending.promise);
    const store = new WeatherSnapshotStore();

    const disconnect = store.connect(bridge, location);
    disconnect();
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.cancel).toHaveBeenCalledOnce();
    expect(bridge.cancel).toHaveBeenCalledWith(location);
    expect(store.getState().isRefreshing).toBe(false);
    pending.resolve(fixture);
    await flushPromises();
    expect(store.getState().weather.snapshot).toBeNull();
  });

  it("cancels the old request and immediately reads a changed location", async () => {
    const bridge = makeBridge();
    const pending = deferred<unknown>();
    bridge.read.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(fixture);
    const store = new WeatherSnapshotStore();
    store.connect(bridge, location);

    const changedLocation = {
      ...location,
      name: "另一个城市",
      latitude: 31.2304,
      longitude: 121.4737,
    };
    const disconnect = store.connect(bridge, changedLocation);
    await flushPromises();

    expect(bridge.cancel).toHaveBeenCalledOnce();
    expect(bridge.cancel).toHaveBeenCalledWith(location);
    expect(bridge.read).toHaveBeenCalledTimes(2);
    expect(bridge.read).toHaveBeenLastCalledWith(changedLocation);
    pending.resolve(fixture);
    await flushPromises();
    disconnect();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("retries a refresh-in-progress response quickly without inventing a transport failure", async () => {
    const bridge = makeBridge();
    bridge.read
      .mockRejectedValueOnce({ code: "refreshInProgress" })
      .mockResolvedValueOnce(fixture);
    const store = new WeatherSnapshotStore();
    const disconnect = store.connect(bridge, location);
    await flushPromises();

    expect(store.getState().weather.failureReason).toBe("notConnected");
    await vi.advanceTimersByTimeAsync(999);
    await flushPromises();
    expect(bridge.read).toHaveBeenCalledTimes(2);

    disconnect();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("retries a resolved cancellation state on the same short busy delay", async () => {
    const bridge = makeBridge();
    bridge.read
      .mockResolvedValueOnce({
        schemaVersion: 1,
        quality: "unavailable",
        snapshot: null,
        failureReason: "cancelled",
        retryAfterMs: 0,
        lastAttemptAtMs: now,
      })
      .mockResolvedValueOnce(fixture);
    const store = new WeatherSnapshotStore();
    const disconnect = store.connect(bridge, location);
    await flushPromises();

    await vi.advanceTimersByTimeAsync(249);
    expect(bridge.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(bridge.read).toHaveBeenCalledTimes(2);

    disconnect();
    await vi.advanceTimersByTimeAsync(0);
  });
});
