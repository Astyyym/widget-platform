import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  applyCodexQuotaFailure,
  createCodexQuotaFreshState,
  parseCodexRateLimitsResponse,
  type CodexQuotaState,
} from "./codex-quota-model";
import { CodexPanel } from "./CodexPanel";

const observedAtMs = 1_790_000_000_123;

function readFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../tests/fixtures/codex/${name}`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

function renderPanel(state: CodexQuotaState, isRefreshing = false): string {
  return renderToStaticMarkup(
    createElement(CodexPanel, {
      state,
      isRefreshing,
      closeButtonRef: null,
      onClose: () => undefined,
    }),
  );
}

describe("Codex quota read-only panel", () => {
  it("shows server-reported windows, durations, source, and separate buckets", () => {
    const snapshot = parseCodexRateLimitsResponse(
      readFixture("current-multi-bucket.json"),
      observedAtMs,
    );
    const html = renderPanel(createCodexQuotaFreshState(snapshot));

    expect(html).toContain("Codex 额度");
    expect(html).toContain("35%");
    expect(html).toContain("5小时");
    expect(html).toContain("72%");
    expect(html).toContain("7天");
    expect(html).toContain("其他额度桶");
    expect(html).toContain("codex_extra");
    expect(html).toContain("12%");
    expect(html).toContain("Codex app-server");
    expect(html).not.toContain("synthetic-fixture-only");
  });

  it("labels stale data and preserves the last successful observation", () => {
    const snapshot = parseCodexRateLimitsResponse(
      readFixture("current-multi-bucket.json"),
      observedAtMs,
    );
    const stale = applyCodexQuotaFailure(
      createCodexQuotaFreshState(snapshot),
      "rateLimited",
      observedAtMs + 5_000,
    );
    const html = renderPanel(stale);

    expect(html).toContain("数据过期");
    expect(html).toContain("官方服务限流");
    expect(html).toContain("上次成功读取");
    expect(html).toContain("35%");
  });

  it("shows authentication failure as unavailable without inventing a percentage", () => {
    const unavailable: CodexQuotaState = {
      quality: "unavailable",
      snapshot: null,
      failureReason: "authRequired",
      lastAttemptAtMs: observedAtMs,
    };
    const html = renderPanel(unavailable);

    expect(html).toContain("需要在 Codex 官方客户端登录");
    expect(html.replace(/<[^>]*>/g, "")).not.toMatch(/\d+%/);
    expect(html).toContain("Codex app-server");
  });

  it("distinguishes a not-yet-started read from a failed attempt", () => {
    const notConnected: CodexQuotaState = {
      quality: "unavailable",
      snapshot: null,
      failureReason: "notConnected",
      lastAttemptAtMs: null,
    };
    const html = renderPanel(notConnected);

    expect(html).toContain("尚未连接官方额度读取");
    expect(html).toContain("尚未发起读取");
    expect(html.replace(/<[^>]*>/g, "")).not.toMatch(/\d+%/);
  });

  it("shows a loading status during the first live read without inventing data", () => {
    const unavailable: CodexQuotaState = {
      quality: "unavailable",
      snapshot: null,
      failureReason: "notConnected",
      lastAttemptAtMs: observedAtMs,
    };
    const html = renderPanel(unavailable, true);

    expect(html).toContain("正在读取 Codex 额度");
    expect(html).toContain('aria-busy="true"');
    expect(html.replace(/<[^>]*>/g, "")).not.toMatch(/\d+%/);
  });

  it("keeps a secondary window visible without presenting it as the primary", () => {
    const snapshot = parseCodexRateLimitsResponse(
      readFixture("missing-primary.json"),
      observedAtMs,
    );
    const html = renderPanel(createCodexQuotaFreshState(snapshot));

    expect(html).toContain("主窗口额度未提供");
    expect(html).toContain("88%");
  });
});
