import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexQuotaBridge } from "./codex-bridge";
import {
  CODEX_QUOTA_REFRESH_INTERVAL_MS,
  CodexQuotaStore,
  shouldConnectCodexQuota,
} from "./codex-quota-store";

const observedAtMs = 1_790_000_000_123;
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/codex/current-multi-bucket.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

function response(at = observedAtMs): Record<string, unknown> {
  return { ...fixture, observedAtMs: at };
}

function makeBridge(): CodexQuotaBridge & {
  read: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
  cancel: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
} {
  return {
    read: vi.fn<() => Promise<unknown>>(),
    cancel: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("Codex quota snapshot store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(observedAtMs);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    { condition: "real visible panel", input: {}, expected: true },
    { condition: "fixture mode", input: { isFixture: true }, expected: false },
    { condition: "hidden document", input: { documentVisible: false }, expected: true },
    { condition: "disabled module", input: { moduleEnabled: false }, expected: false },
    { condition: "closed panel", input: { panelActive: false }, expected: true },
    { condition: "hidden widget", input: { hidden: true }, expected: true },
    { condition: "settings open", input: { settingsOpen: true }, expected: true },
  ])("connects only for a $condition", ({ input, expected }) => {
    expect(
      shouldConnectCodexQuota({
        isFixture: false,
        documentVisible: true,
        moduleEnabled: true,
        panelActive: true,
        hidden: false,
        settingsOpen: false,
        ...input,
      }),
    ).toBe(expected);
  });

  it("loads once and keeps the backend observation timestamp", async () => {
    expect(CODEX_QUOTA_REFRESH_INTERVAL_MS).toBe(180_000);
    const bridge = makeBridge();
    bridge.read.mockResolvedValue(response());
    const store = new CodexQuotaStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const disconnect = store.connect(bridge);
    expect(store.getState().isRefreshing).toBe(true);
    await flushPromises();

    expect(bridge.read).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      isRefreshing: false,
      quota: {
        quality: "fresh",
        snapshot: { observedAtMs },
      },
    });
    expect(listener).toHaveBeenCalled();

    disconnect();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("preserves last-good data and waits through the refresh interval when reopened", async () => {
    const bridge = makeBridge();
    bridge.read
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response(observedAtMs + CODEX_QUOTA_REFRESH_INTERVAL_MS));
    const store = new CodexQuotaStore();

    const firstDisconnect = store.connect(bridge);
    await flushPromises();
    firstDisconnect();
    await vi.advanceTimersByTimeAsync(0);

    const secondDisconnect = store.connect(bridge);
    expect(bridge.read).toHaveBeenCalledOnce();
    expect(store.getState().quota.quality).toBe("fresh");
    await vi.advanceTimersByTimeAsync(CODEX_QUOTA_REFRESH_INTERVAL_MS - 1);
    expect(bridge.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();

    expect(bridge.read).toHaveBeenCalledTimes(2);
    expect(store.getState().quota.snapshot?.observedAtMs).toBe(
      observedAtMs + CODEX_QUOTA_REFRESH_INTERVAL_MS,
    );
    secondDisconnect();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("marks failed refreshes stale without changing the last successful timestamp", async () => {
    const bridge = makeBridge();
    bridge.read
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce({ code: "rateLimited", retryAfterMs: 60_000 });
    const store = new CodexQuotaStore();
    const disconnect = store.connect(bridge);
    await flushPromises();

    await vi.advanceTimersByTimeAsync(CODEX_QUOTA_REFRESH_INTERVAL_MS);
    await flushPromises();

    expect(store.getState().quota).toMatchObject({
      quality: "stale",
      failureReason: "rateLimited",
      snapshot: { observedAtMs },
      lastAttemptAtMs: observedAtMs + CODEX_QUOTA_REFRESH_INTERVAL_MS,
    });
    disconnect();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("respects refreshNotDue retryAfterMs without treating the cooldown as data", async () => {
    const bridge = makeBridge();
    bridge.read
      .mockRejectedValueOnce({ code: "refreshNotDue", retryAfterMs: 1_234 })
      .mockResolvedValueOnce(response());
    const store = new CodexQuotaStore();
    const disconnect = store.connect(bridge);
    await flushPromises();

    expect(store.getState().quota).toMatchObject({
      quality: "unavailable",
      snapshot: null,
      failureReason: "refreshNotDue",
    });
    await vi.advanceTimersByTimeAsync(1_233);
    expect(bridge.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();

    expect(bridge.read).toHaveBeenCalledTimes(2);
    expect(store.getState().quota).toMatchObject({
      quality: "fresh",
      snapshot: { observedAtMs },
    });
    disconnect();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("does not cancel a read during React StrictMode's immediate reconnect", async () => {
    const bridge = makeBridge();
    const pending = deferred<unknown>();
    bridge.read.mockReturnValue(pending.promise);
    const store = new CodexQuotaStore();

    const firstDisconnect = store.connect(bridge);
    firstDisconnect();
    const secondDisconnect = store.connect(bridge);
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.cancel).not.toHaveBeenCalled();
    expect(bridge.read).toHaveBeenCalledOnce();
    pending.resolve(response());
    await flushPromises();
    expect(store.getState().quota.quality).toBe("fresh");

    secondDisconnect();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("cancels an in-flight read after the last visible consumer leaves", async () => {
    const bridge = makeBridge();
    const pending = deferred<unknown>();
    bridge.read.mockReturnValue(pending.promise);
    const store = new CodexQuotaStore();

    const disconnect = store.connect(bridge);
    disconnect();
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.cancel).toHaveBeenCalledOnce();
    expect(store.getState().isRefreshing).toBe(false);
    pending.resolve(response());
    await flushPromises();

    expect(store.getState().quota).toMatchObject({
      quality: "unavailable",
      snapshot: null,
    });
  });
});
