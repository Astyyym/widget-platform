import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalIcon } from "../../shell/LocalIcon";
import { CodexPanel } from "./CodexPanel";
import { applyCodexQuotaFailure, createCodexQuotaFreshState, type CodexQuotaState } from "./codex-quota-model";

const fresh = createCodexQuotaFreshState({
  source: "codex-app-server", observedAtMs: 10_000,
  coreBucket: { id: "codex", primary: { usedPercent: 35, windowDurationMinutes: 300, resetsAtMs: 20_000 }, secondary: null },
  otherBuckets: [],
});
const empty: CodexQuotaState = {
  quality: "unavailable", snapshot: null, failureReason: "notConnected", lastAttemptAtMs: null,
};

describe("Codex panel local return icon", () => {
  it("keeps a single decorative 16px return arrow across all data and loading states", () => {
    const arrow = renderToStaticMarkup(createElement(LocalIcon, { name: "x", size: 16 }));
    for (const state of [fresh, applyCodexQuotaFailure(fresh, "rateLimited", 30_000), empty,
      applyCodexQuotaFailure(null, "authRequired", 30_000)]) {
      for (const isRefreshing of [false, true]) {
        const markup = renderToStaticMarkup(createElement(CodexPanel, {
          state, isRefreshing, closeButtonRef: createRef<HTMLButtonElement>(), onClose: () => undefined,
        }));
        expect(markup).toContain('aria-label="关闭详情" class="shell-panel-close"');
        expect(markup).toContain(arrow);
        expect(markup.match(/class="local-icon"/g)).toHaveLength(1);
        expect(markup).not.toContain("×");
        expect(markup).toContain("Codex app-server");
        expect(markup).toContain("Codex 额度");
        if (state.snapshot) expect(markup).toContain("35%");
        else expect(markup.replace(/<[^>]*>/g, "")).not.toMatch(/\d+%/);
        if (isRefreshing) expect(markup).toContain('aria-busy="true"');
        if (state.snapshot) expect(markup).toContain('aria-label="Codex额度已用进度"');
      }
    }
  });
});
