import { describe, expect, it } from "vitest";
import {
  formatMediaModuleSummary,
  formatMediaSourceLabel,
  formatMediaTime,
  clampMediaSeekPosition,
  isMediaControlSupported,
  mediaArtworkDataUrl,
  mediaControlFailureMessage,
  mediaProgress,
  resolveCurrentMediaSession,
} from "./media-panel-model";
import type { MediaSession } from "./media-store";

const session: MediaSession = {
  sessionId: "session-1",
  sourceAppUserModelId: "cloudmusic.exe",
  title: "Track",
  artist: "Artist",
  albumTitle: null,
  artworkRef: null,
  playbackState: "playing",
  timeline: { startMs: 1_000, endMs: 11_000, positionMs: 6_000 },
  capabilities: {
    canPlay: true,
    canPause: true,
    canPrevious: false,
    canNext: false,
    canSeek: false,
  },
  quality: "available",
};

describe("media panel presentation model", () => {
  it("enables only controls explicitly supported by the session", () => {
    expect(isMediaControlSupported(session, "play")).toBe(true);
    expect(isMediaControlSupported(session, "pause")).toBe(true);
    expect(isMediaControlSupported(session, "previous")).toBe(false);
    expect(isMediaControlSupported(session, "next")).toBe(false);
    expect(isMediaControlSupported(session, "seek")).toBe(false);
    expect(
      isMediaControlSupported(
        {
          ...session,
          capabilities: { ...session.capabilities, canPlay: null },
        },
        "play",
      ),
    ).toBe(false);
  });

  it("clamps seek drafts and maps native errors without exposing raw text", () => {
    expect(clampMediaSeekPosition(-250, 10_000)).toBe(0);
    expect(clampMediaSeekPosition(15_500, 10_000)).toBe(10_000);
    expect(clampMediaSeekPosition(Number.NaN, 10_000)).toBeNull();
    expect(clampMediaSeekPosition(1, 0)).toBeNull();
    expect(mediaControlFailureMessage("MEDIA_SESSION_NOT_FOUND")).toBe(
      "媒体会话已结束，请重新选择。",
    );
    expect(mediaControlFailureMessage("provider detail contains private text")).toBe(
      "媒体操作失败；请稍后查看播放状态。",
    );
  });

  it("selects only the session named by the native current-session ID", () => {
    expect(
      resolveCurrentMediaSession({
        observedAtMs: 10_000,
        health: "available",
        error: null,
        currentSessionId: "session-1",
        sessions: [session],
      }),
    ).toEqual(session);
    expect(resolveCurrentMediaSession(null)).toBeNull();
  });

  it("shows real playback status and maps the two authorized source labels", () => {
    expect(
      formatMediaModuleSummary({
        snapshot: {
          observedAtMs: 10_000,
          health: "available",
          error: null,
          currentSessionId: "session-1",
          sessions: [session],
        },
        error: null,
      }),
    ).toBe("正在播放 · Track");
    expect(formatMediaSourceLabel("cloudmusic.exe", 0)).toBe("网易云音乐");
    expect(formatMediaSourceLabel("MSEdge", 1)).toBe("Microsoft Edge");
    expect(formatMediaSourceLabel("unknown", 0)).toBe("媒体播放器 1");
  });

  it("advances playing progress from the snapshot time and clamps at the end", () => {
    expect(mediaProgress(session, 10_000, 12_000)).toEqual({
      durationMs: 10_000,
      currentMs: 7_000,
      percentage: 70,
    });
    expect(mediaProgress(session, 10_000, 30_000)?.percentage).toBe(100);
    expect(
      mediaProgress(
        { ...session, playbackState: "paused" },
        10_000,
        30_000,
      )?.percentage,
    ).toBe(50);
    expect(formatMediaTime(3_661_000)).toBe("01:01:01");
  });

  it("accepts only bounded raster artwork types", () => {
    expect(
      mediaArtworkDataUrl({ contentType: "image/png", bytes: new Uint8Array([1, 2]) }),
    ).toBe("data:image/png;base64,AQI=");
    expect(
      mediaArtworkDataUrl({ contentType: "image/svg+xml", bytes: new Uint8Array([1]) }),
    ).toBeNull();
  });
});
