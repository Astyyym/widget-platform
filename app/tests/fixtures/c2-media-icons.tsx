import { createRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MediaPanel } from "../../src/features/media/MediaPanel";
import { mediaBridge } from "../../src/features/media/media-bridge";
import { MediaSnapshotStore, parseMediaSnapshot, type MediaSession, type MediaViewState, type MediaControlAction } from "../../src/features/media/media-store";
import { ICON_SOURCES } from "../../src/shell/LocalIcon";
import "../../src/styles.css";
import "../../src/shell/shell-frame.css";

// E1 only: real panel, synthetic parsed views, no Store.connect or native calls.
type Scenario = "playing" | "paused" | "limited" | "empty" | "loading" | "unavailable" | "partial" | "multi" | "artwork";
type ReplyMode = "accepted" | "false" | "exception" | "hold";
const store = new MediaSnapshotStore();
const now = 10_000;
const calls: { sessionId: string; action: MediaControlAction; positionMs?: number }[] = [];
const unexpected: string[] = [];
let view: MediaViewState;
let generation = 0, closed = false, replyMode: ReplyMode = "accepted";
let settle: ((accepted: boolean) => void) | null = null;
const root = createRoot(document.getElementById("root")!);
function session(id: string): MediaSession {
  return { sessionId: id, sourceAppUserModelId: "synthetic-player",
    title: "合成媒体样例：用于检查窄屏中文长标题、省略显示与控制图标布局", artist: "合成艺术家", albumTitle: "合成专辑",
    artworkRef: null, playbackState: "playing", quality: "available",
    timeline: { startMs: 0, endMs: 120_000, positionMs: 30_000 },
    capabilities: { canPlay: true, canPause: true, canPrevious: true, canNext: true, canSeek: true } };
}
function Fixture() {
  const [isClosed, setClosed] = useState(false);
  return <main className="shell-stage">{isClosed ? <p role="status">已返回摘要（隔离样例）</p> :
    <section aria-label="媒体活动面板" role="dialog" className="shell-activity-panel media-activity-panel edge-top">
      <MediaPanel closeButtonRef={createRef<HTMLButtonElement>()} now={now} store={store} view={view}
        onClose={() => { closed = true; setClosed(true); }} />
    </section>}</main>;
}
function render() { flushSync(() => root.render(<Fixture key={generation} />)); }
function reset(scenario: Scenario = "playing") {
  if (settle) throw new Error("Settle the pending synthetic control before reset");
  calls.length = 0; closed = false; replyMode = "accepted";
  const item = session("first");
  if (scenario === "paused") item.playbackState = "paused";
  if (scenario === "limited") item.capabilities = { canPlay: null, canPause: true, canPrevious: false, canNext: false, canSeek: false };
  if (scenario === "partial") {
    item.title = null; item.artist = null; item.albumTitle = null; item.quality = "partial";
    item.timeline = { startMs: null, endMs: null, positionMs: null };
    item.capabilities = { canPlay: null, canPause: null, canPrevious: null, canNext: null, canSeek: null };
  }
  if (scenario === "artwork") item.artworkRef = "synthetic-artwork";
  const sessions = ["empty", "unavailable"].includes(scenario) ? [] : [item];
  if (scenario === "multi") sessions.push({ ...session("second"), title: "第二个合成会话", playbackState: "paused" });
  view = { snapshot: scenario === "loading" ? null : parseMediaSnapshot({ observedAtMs: now,
    health: scenario === "unavailable" ? "unavailable" : scenario === "partial" ? "partial" : "available",
    error: scenario === "unavailable" ? "providerUnavailable" : null, currentSessionId: sessions[0]?.sessionId ?? null, sessions }), error: null };
  generation += 1; render();
}
async function forbidden(name: string): Promise<never> { unexpected.push(name); throw new Error(`Unexpected native path: ${name}`); }
Object.assign(mediaBridge, {
  subscribe: () => forbidden("subscribe"), snapshot: () => forbidden("snapshot"), unsubscribe: () => forbidden("unsubscribe"),
  artwork: async (reference: string) => {
    if (reference !== "synthetic-artwork") return forbidden("artwork");
    // Local 1px PNG; never a remote cover or real media image.
    return { contentType: "image/png", bytes: Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII="), c => c.charCodeAt(0)) };
  },
  control: async (sessionId: string, action: MediaControlAction, positionMs?: number) => {
    calls.push({ sessionId, action, ...(positionMs === undefined ? {} : { positionMs }) });
    if (replyMode === "exception") throw new Error("MEDIA_CONTROL_FAILED");
    const accepted = replyMode === "hold" ? await new Promise<boolean>(resolve => { settle = resolve; }) : replyMode === "accepted";
    if (accepted && view.snapshot) {
      const next = structuredClone(view.snapshot);
      const selected = next.sessions.find(item => item.sessionId === sessionId)!;
      if (action === "play") selected.playbackState = "playing";
      if (action === "pause") selected.playbackState = "paused";
      if (action === "seek" && positionMs !== undefined) selected.timeline.positionMs = positionMs;
      view = { ...view, snapshot: parseMediaSnapshot(next) }; render();
    }
    return accepted;
  },
});
declare global {
  interface Window {
    __resetMediaIcons: typeof reset;
    __mediaIconState: () => { view: MediaViewState; calls: typeof calls; unexpected: string[]; closed: boolean; pending: boolean };
    __setMediaReply: (mode: ReplyMode) => void;
    __settleMediaControl: (accepted: boolean) => void;
    __mediaIconSources: typeof ICON_SOURCES;
  }
}
window.__resetMediaIcons = reset;
window.__mediaIconState = () => structuredClone({ view, calls, unexpected, closed, pending: !!settle });
window.__setMediaReply = mode => { replyMode = mode; };
window.__settleMediaControl = accepted => { const resolve = settle; settle = null; resolve?.(accepted); };
window.__mediaIconSources = ICON_SOURCES;
reset();
