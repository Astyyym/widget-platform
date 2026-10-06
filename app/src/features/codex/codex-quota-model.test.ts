import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyCodexQuotaFailure,
  classifyCodexQuotaFailure,
  classifyCodexQuotaCommandError,
  createCodexQuotaFreshState,
  describeCodexQuotaFailure,
  formatCodexQuotaSummary,
  getCodexQuotaProgress,
  parseCodexQuotaCommandError,
  parseCodexQuotaCommandResponse,
  parseCodexRateLimitsResponse,
} from "./codex-quota-model";

const multiBucketFixture = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/codex/current-multi-bucket.json", import.meta.url),
    "utf8",
  ),
) as unknown;
const legacyFixture = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/codex/legacy-single-bucket.json", import.meta.url),
    "utf8",
  ),
) as unknown;
const missingPrimaryFixture = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/codex/missing-primary.json", import.meta.url),
    "utf8",
  ),
) as unknown;

describe("Codex app-server quota parser", () => {
  it("separates the core bucket from other buckets and converts server time units", () => {
    const observedAtMs = 1_790_000_000_123;
    const snapshot = parseCodexRateLimitsResponse(multiBucketFixture, observedAtMs);

    expect(snapshot).toMatchObject({
      source: "codex-app-server",
      observedAtMs,
      coreBucket: {
        id: "codex",
        primary: {
          usedPercent: 35,
          windowDurationMinutes: 300,
          resetsAtMs: 1_800_000_000_000,
        },
        secondary: {
          usedPercent: 72,
          windowDurationMinutes: 10_080,
          resetsAtMs: 1_800_060_000_000,
        },
      },
      otherBuckets: [
        {
          id: "codex_extra",
          primary: {
            usedPercent: 12,
            windowDurationMinutes: 60,
            resetsAtMs: 1_800_003_600_000,
          },
          secondary: null,
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain("synthetic-fixture-only");
  });

  it("accepts the legacy single-bucket response without inventing a window duration", () => {
    const snapshot = parseCodexRateLimitsResponse(legacyFixture, 1_790_000_000_123);

    expect(snapshot.coreBucket).toEqual({
      id: "codex",
      primary: {
        usedPercent: 81,
        windowDurationMinutes: 10_080,
        resetsAtMs: 1_800_060_000_000,
      },
      secondary: null,
    });
    expect(snapshot.otherBuckets).toEqual([]);
  });

  it("does not substitute the secondary window for a missing primary window", () => {
    const snapshot = parseCodexRateLimitsResponse(
      missingPrimaryFixture,
      1_790_000_000_123,
    );
    const state = createCodexQuotaFreshState(snapshot);

    expect(snapshot.coreBucket?.primary).toBeNull();
    expect(snapshot.coreBucket?.secondary?.usedPercent).toBe(88);
    expect(getCodexQuotaProgress(state)).toBeUndefined();
    expect(formatCodexQuotaSummary(state)).toBe("主窗口额度未提供");
  });

  it("keeps the original observation time when a refresh failure makes data stale", () => {
    const snapshot = parseCodexRateLimitsResponse(
      multiBucketFixture,
      1_790_000_000_123,
    );
    const fresh = createCodexQuotaFreshState(snapshot);
    const stale = applyCodexQuotaFailure(
      fresh,
      "rateLimited",
      1_790_000_005_123,
    );

    expect(stale).toMatchObject({
      quality: "stale",
      failureReason: "rateLimited",
      lastAttemptAtMs: 1_790_000_005_123,
    });
    expect(stale.snapshot).toBe(snapshot);
    expect(stale.snapshot?.observedAtMs).toBe(1_790_000_000_123);
    expect(formatCodexQuotaSummary(stale)).toBe("数据过期 · 主窗口已用 35%");
  });

  it.each([
    { input: { status: 401 }, expected: "authRequired" },
    { input: { status: 403 }, expected: "permissionDenied" },
    { input: { status: 429 }, expected: "rateLimited" },
    { input: { timedOut: true }, expected: "timeout" },
    { input: { invalidResponse: true }, expected: "invalidResponse" },
    { input: { status: 503 }, expected: "transportError" },
  ])("keeps $expected failures distinct", ({ input, expected }) => {
    expect(classifyCodexQuotaFailure(input)).toBe(expected);
  });

  it.each([
    { reason: "authRequired", label: "需要在 Codex 官方客户端登录" },
    { reason: "permissionDenied", label: "官方接口拒绝了额度读取" },
    { reason: "rateLimited", label: "官方服务限流；稍后重试" },
    { reason: "timeout", label: "官方读取超时" },
  ] as const)("describes $reason without changing it to a quota value", ({ reason, label }) => {
    expect(describeCodexQuotaFailure(reason)).toBe(label);
  });

  it("uses the backend observation timestamp in a Tauri command response", () => {
    const commandObservedAtMs = 1_790_000_000_123;
    const response = Object.assign({}, multiBucketFixture, {
      observedAtMs: commandObservedAtMs,
    });

    expect(parseCodexQuotaCommandResponse(response)).toMatchObject({
      source: "codex-app-server",
      observedAtMs: commandObservedAtMs,
      coreBucket: { id: "codex" },
    });
  });

  it.each([
    { code: "configurationError", expected: "configurationError" },
    { code: "gatewayAuthNotReady", expected: "gatewayAuthNotReady" },
    { code: "outputLimit", expected: "outputLimit" },
    { code: "refreshNotDue", expected: "refreshNotDue" },
    { code: "cleanupFailed", expected: "cleanupFailed" },
    { code: "refreshInProgress", expected: null },
    { code: "cancelled", expected: null },
    { code: "unrecognized", expected: "transportError" },
  ])("classifies backend command code $code safely", ({ code, expected }) => {
    expect(classifyCodexQuotaCommandError({ code })).toBe(expected);
  });

  it("keeps only the safe retry delay and error code from the command rejection", () => {
    expect(
      parseCodexQuotaCommandError({
        code: "refreshNotDue",
        message: "must not reach the UI",
        retryAfterMs: 12_345,
      }),
    ).toEqual({ code: "refreshNotDue", retryAfterMs: 12_345 });
    expect(
      parseCodexQuotaCommandError({ code: "timeout", retryAfterMs: -1 }),
    ).toEqual({ code: "timeout", retryAfterMs: null });
    expect(parseCodexQuotaCommandError("private raw error")).toEqual({
      code: "transportError",
      retryAfterMs: null,
    });
  });
});
