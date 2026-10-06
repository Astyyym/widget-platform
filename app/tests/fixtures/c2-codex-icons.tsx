import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../../src/shell/shell-frame.css";
import { ICON_SOURCES } from "../../src/shell/LocalIcon";
import { CodexPanel } from "../../src/features/codex/CodexPanel";
import { applyCodexQuotaFailure, createCodexQuotaFreshState, type CodexQuotaState, type CodexQuotaSnapshot } from "../../src/features/codex/codex-quota-model";

// E1 only. No Shell/Store/bridge, app-server, credentials, IPC or live quota reads.
const observedAtMs = Date.UTC(2026, 8, 30, 0, 0);
const snapshot: CodexQuotaSnapshot = {
  source: "codex-app-server", observedAtMs,
  coreBucket: { id: "codex", primary: { usedPercent: 35, windowDurationMinutes: 300, resetsAtMs: observedAtMs + 3_600_000 },
    secondary: { usedPercent: 72, windowDurationMinutes: 10_080, resetsAtMs: observedAtMs + 86_400_000 } },
  otherBuckets: [{ id: "synthetic_extra", primary: { usedPercent: 12, windowDurationMinutes: null, resetsAtMs: null }, secondary: null }],
};
type Scenario = "fresh" | "stale" | "unavailable" | "idle" | "loading" | "refreshing" | "missingPrimary" | "missingCore" | "noWindows";
let scenario: Scenario = "fresh", closed = false;
const root = createRoot(document.getElementById("root")!);
const closeButtonRef = createRef<HTMLButtonElement>();
function getState(): CodexQuotaState {
  if (["idle", "loading"].includes(scenario)) return { quality: "unavailable", snapshot: null, failureReason: "notConnected", lastAttemptAtMs: scenario === "idle" ? null : observedAtMs };
  if (scenario === "unavailable") return applyCodexQuotaFailure(null, "authRequired", observedAtMs + 60_000);
  if (scenario === "stale") return applyCodexQuotaFailure(createCodexQuotaFreshState(snapshot), "rateLimited", observedAtMs + 60_000);
  if (scenario === "missingCore") return createCodexQuotaFreshState({ ...snapshot, coreBucket: null });
  if (scenario === "missingPrimary") return createCodexQuotaFreshState({ ...snapshot, coreBucket: { ...snapshot.coreBucket!, primary: null } });
  if (scenario === "noWindows") return createCodexQuotaFreshState({ ...snapshot, coreBucket: { id: "codex", primary: null, secondary: null }, otherBuckets: [] });
  return createCodexQuotaFreshState(snapshot);
}
function close() { closed = true; render(); }
function render() {
  flushSync(() => root.render(
    <div className="shell-stage" style={{ minHeight: "100vh" }}>
      <button id="fixture-focus-start" type="button" style={{ position: "absolute", left: 16, top: 8 }}>合成摘要入口</button>
      {closed ? <p>已返回摘要</p> : <section aria-label="合成额度面板" className="shell-activity-panel edge-top" style={{ top: 60 }}>
        <CodexPanel state={getState()} isRefreshing={scenario === "loading" || scenario === "refreshing"} closeButtonRef={closeButtonRef} onClose={close} />
      </section>}
    </div>,
  ));
}
declare global {
  interface Window {
    __resetCodexIcons: (value: Scenario) => void;
    __codexIconState: () => { scenario: Scenario; closed: boolean; state: CodexQuotaState; observedTime: string; attemptTime: string };
    __codexIconSources: typeof ICON_SOURCES;
  }
}
const formatTime = (timestamp: number) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
window.__resetCodexIcons = value => { scenario = value; closed = false; render(); };
window.__codexIconState = () => ({ scenario, closed, state: getState(), observedTime: formatTime(observedAtMs), attemptTime: formatTime(observedAtMs + 60_000) });
window.__codexIconSources = ICON_SOURCES;
render();
