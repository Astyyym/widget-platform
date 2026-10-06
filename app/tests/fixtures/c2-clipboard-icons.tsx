import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../../src/shell/shell-frame.css";
import { ICON_SOURCES } from "../../src/shell/LocalIcon";
import { ClipboardPanel } from "../../src/features/clipboard/ClipboardPanel";
import { ClipboardSnapshotStore, type ClipboardBridge } from "../../src/features/clipboard/clipboard-store";
import type { ClipboardEntry, ClipboardSnapshot } from "../../src/features/clipboard/clipboard-model";

// E1 only. Every bridge method is synthetic memory or rejection; no native bridge,
// listener, navigator.clipboard, Shell, real persistence or private history access.
type Scenario = "history" | "empty" | "unread" | "failure" | "listenerError" | "long" | "pagination";
type MutationMode = "normal" | "fail" | "pending";
const root = createRoot(document.getElementById("root")!);
const closeButtonRef = createRef<HTMLButtonElement>();
let scenario: Scenario = "history", closed = false, revision = 1;
let entries: ClipboardEntry[] = [], calls: { operation: string; entryId?: string; actionId?: string; offset?: number }[] = [];
let mode: MutationMode = "normal", releaseCopy: (() => void) | null = null, unexpectedNativePaths = 0;
let store: ClipboardSnapshotStore;
function entry(index: number, text = `合成测试文本 ${index}`): ClipboardEntry {
  return { id: `clip-${index}`, text, createdAtMs: Date.UTC(2026, 8, 30, 0, index), sourceAppId: "synthetic-app", pinned: false, byteLen: new TextEncoder().encode(text).length };
}
function data(offset = 0, limit = 100): ClipboardSnapshot {
  return { revision, enabled: false, listening: false, totalEntries: entries.length,
    entries: entries.slice(offset, offset + limit), error: scenario === "listenerError" ? "synthetic-error" : null };
}
function createStore(): ClipboardSnapshotStore {
  const bridge: ClipboardBridge = {
    snapshot: async (offset = 0, limit = 100) => {
      calls.push({ operation: "snapshot", offset });
      if (scenario === "unread") return new Promise<never>(() => undefined);
      if (scenario === "failure") throw new Error("Synthetic snapshot failure");
      return data(offset, limit);
    },
    setEnabled: async () => { unexpectedNativePaths++; throw new Error("Listener enable forbidden in E1"); },
    copy: async (entryId, actionId) => {
      calls.push({ operation: "copy", entryId, actionId });
      if (mode === "fail") throw new Error("Synthetic copy failure");
      if (mode === "pending") await new Promise<void>(resolve => { releaseCopy = resolve; });
      return { synthetic: true };
    },
    deleteEntry: async entryId => {
      calls.push({ operation: "delete", entryId });
      if (mode === "fail") throw new Error("Synthetic delete failure");
      entries = entries.filter(item => item.id !== entryId); revision++;
      return { synthetic: true };
    },
    clearAll: async () => {
      calls.push({ operation: "clear" });
      if (mode === "fail") throw new Error("Synthetic clear failure");
      entries = []; revision++;
      return { synthetic: true };
    },
  };
  return new ClipboardSnapshotStore(bridge);
}
function close() { closed = true; render(); }
function render() {
  flushSync(() => root.render(<div className="shell-stage" style={{ minHeight: "100vh" }}>
    <button id="fixture-focus-start" type="button" style={{ position: "absolute", left: 16, top: 8 }}>合成摘要入口</button>
    {closed ? <p>已返回摘要</p> : <section aria-label="合成剪贴板面板" className="shell-activity-panel edge-top" style={{ top: 60 }}>
      <ClipboardPanel store={store} closeButtonRef={closeButtonRef} onClose={close} />
    </section>}
  </div>));
}
async function reset(value: Scenario) {
  flushSync(() => root.render(null));
  scenario = value; closed = false; revision = 1; calls = []; mode = "normal"; releaseCopy = null;
  entries = value === "pagination" ? Array.from({ length: 101 }, (_, i) => entry(i + 1))
    : value === "long" ? [entry(1, "合成长文本\n" + "长内容".repeat(200)), entry(2, '<img src=x onerror="window.__unsafeClipboardHtml=true">')]
    : ["empty", "unread", "failure"].includes(value) ? [] : [entry(1), entry(2)];
  store = createStore();
  if (value !== "unread") await store.refresh();
  render();
}
declare global { interface Window {
  __resetClipboardIcons: (value: Scenario) => Promise<void>;
  __clipboardIconState: () => { scenario: Scenario; closed: boolean; state: ReturnType<ClipboardSnapshotStore["getState"]>; calls: typeof calls; unexpectedNativePaths: number };
  __clipboardIconSources: typeof ICON_SOURCES;
  __setClipboardMutation: (value: MutationMode) => void;
  __resolveMemoryCopy: () => void;
  __unsafeClipboardHtml?: boolean;
} }
window.__resetClipboardIcons = reset;
window.__clipboardIconState = () => ({ scenario, closed, state: store.getState(), calls, unexpectedNativePaths });
window.__clipboardIconSources = ICON_SOURCES;
window.__setClipboardMutation = value => { mode = value; };
window.__resolveMemoryCopy = () => { releaseCopy?.(); releaseCopy = null; };
void reset("history");
