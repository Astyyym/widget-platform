import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalIcon, type IconName } from "../../shell/LocalIcon";
import { MediaPanel } from "./MediaPanel";
import { MediaSnapshotStore, type MediaSession, type MediaViewState } from "./media-store";

const session: MediaSession = {
  sessionId: "icon-test", sourceAppUserModelId: "synthetic-player",
  title: "合成媒体样例", artist: "合成艺术家", albumTitle: "合成专辑",
  artworkRef: null, playbackState: "playing",
  timeline: { startMs: 0, endMs: 120_000, positionMs: 30_000 },
  capabilities: { canPlay: true, canPause: true, canPrevious: false, canNext: false, canSeek: false },
  quality: "available",
};
function view(sessions: MediaSession[] = [session]): MediaViewState {
  return { snapshot: { observedAtMs: 10_000, health: "available", error: null,
    currentSessionId: sessions[0]?.sessionId ?? null, sessions }, error: null };
}
function renderPanel(value = view()): string {
  return renderToStaticMarkup(createElement(MediaPanel, {
    closeButtonRef: createRef<HTMLButtonElement>(), onClose: () => undefined,
    now: 10_000, store: new MediaSnapshotStore(), view: value,
  }));
}
function icon(name: IconName, size: number): string {
  return renderToStaticMarkup(createElement(LocalIcon, { name, size }));
}

describe("Media panel local icons", () => {
  it("uses the same accessible return icon in loaded and empty states", () => {
    for (const value of [view(), view([])]) {
      const header = renderPanel(value).match(/<header>[\s\S]*?<\/header>/)?.[0] ?? "";
      expect(header).toContain('aria-label="关闭详情"');
      expect(header).toContain(icon("x", 16));
      expect(header).not.toContain("×");
    }
  });

  it("uses three control icons with a merged play/pause toggle while preserving supported and disabled actions", () => {
    for (const playbackState of ["playing", "paused"] as const) {
      const markup = renderPanel(view([{ ...session, playbackState }]));
      const isPlaying = playbackState === "playing";
      const middleIcon = isPlaying ? "pause" : "play";
      const middleLabel = isPlaying ? "暂停" : "播放";
      for (const name of ["skip-back", middleIcon, "skip-forward"] as const)
        expect(markup).toContain(icon(name, 20));
      // Only the state-appropriate middle label renders, never both at once.
      expect(markup).toContain(`aria-label="${middleLabel}"`);
      expect(markup).not.toContain(`aria-label="${isPlaying ? "播放" : "暂停"}"`);
      expect(markup).toContain('aria-label="上一首" class="media-control-button" disabled=""');
      expect(markup).toContain('aria-label="下一首" class="media-control-button" disabled=""');
      expect(markup).toContain(
        `aria-label="${middleLabel}" class="media-control-button" title="${middleLabel}"`,
      );
      expect(markup).toContain("合成媒体样例");
      expect(markup).toContain("合成艺术家");
      expect(markup).toContain("0:30 / 2:00");
      for (const glyph of ["|◀", "▶", "Ⅱ", "▶|"]) expect(markup).not.toContain(glyph);
    }
  });
  it("uses local music placeholders without hiding the empty-state explanation", () => {
    const loaded = renderPanel();
    expect(loaded).toContain('class="media-artwork-placeholder"');
    expect(loaded).toContain(icon("music", 40));
    const empty = renderPanel(view([]));
    expect(empty).toContain(icon("music", 28));
    expect(empty).toContain("没有可显示的媒体会话");
    expect(empty).toContain("播放媒体后，标题和播放进度会显示在这里。");
    expect(empty).toContain("按 Esc 或返回按钮回到摘要");
    for (const markup of [loaded, empty]) expect(markup).not.toContain("♫");
  });
});
