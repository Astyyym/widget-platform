import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MediaPreviewCard } from "./MediaPreviewCard";
import type { MediaSession, MediaViewState } from "./media-store";

const session: MediaSession = {
  sessionId: "preview-test",
  sourceAppUserModelId: "cloudmusic",
  title: "合成媒体样例",
  artist: "合成艺术家",
  albumTitle: "合成专辑",
  artworkRef: null,
  playbackState: "playing",
  timeline: { startMs: 0, endMs: 120_000, positionMs: 30_000 },
  capabilities: { canPlay: true, canPause: true, canPrevious: true, canNext: true, canSeek: true },
  quality: "available",
};

function view(overrides: Partial<MediaViewState> = {}): MediaViewState {
  return {
    snapshot: {
      observedAtMs: 10_000,
      health: "available",
      error: null,
      currentSessionId: session.sessionId,
      sessions: [session],
    },
    error: null,
    ...overrides,
  };
}

function render(value: MediaViewState): string {
  return renderToStaticMarkup(createElement(MediaPreviewCard, { view: value }));
}

describe("MediaPreviewCard", () => {
  it("shows title, artist, source, and playback state without controls", () => {
    const markup = render(view());
    expect(markup).toContain("合成媒体样例");
    expect(markup).toContain("合成艺术家");
    expect(markup).toContain("网易云音乐");
    expect(markup).toContain("正在播放");
    // Display-only: no interactive control buttons in the popover card.
    expect(markup).not.toContain("media-control-button");
    expect(markup).not.toContain("aria-label=\"上一首\"");
  });

  it("reports unavailable media without inventing a session", () => {
    expect(render({ snapshot: null, error: "媒体读取失败" })).toContain("媒体信息暂不可用");
    expect(render({ snapshot: null, error: null })).toContain("正在连接媒体");
  });

  it("reports an idle provider when there is no current session", () => {
    const idle: MediaViewState = {
      snapshot: { observedAtMs: 10_000, health: "available", error: null, currentSessionId: null, sessions: [] },
      error: null,
    };
    expect(render(idle)).toContain("暂无媒体播放");
  });
});
