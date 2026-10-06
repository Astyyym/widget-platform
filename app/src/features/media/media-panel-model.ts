import type {
  MediaArtwork,
  MediaControlAction,
  MediaPlaybackState,
  MediaSession,
  MediaSnapshot,
  MediaViewState,
} from "./media-store";

export type MediaProgress = {
  durationMs: number;
  currentMs: number;
  percentage: number;
};

export function isMediaControlSupported(
  session: MediaSession,
  action: MediaControlAction,
): boolean {
  switch (action) {
    case "play":
      return session.capabilities.canPlay === true;
    case "pause":
      return session.capabilities.canPause === true;
    case "previous":
      return session.capabilities.canPrevious === true;
    case "next":
      return session.capabilities.canNext === true;
    case "seek":
      return session.capabilities.canSeek === true;
  }
}

export function clampMediaSeekPosition(
  requestedMs: number,
  durationMs: number,
): number | null {
  if (
    !Number.isFinite(requestedMs) ||
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0
  ) {
    return null;
  }
  return Math.round(Math.max(0, Math.min(durationMs, requestedMs)));
}

export function mediaControlFailureMessage(error: unknown): string {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  switch (message) {
    case "MEDIA_CONTROL_UNSUPPORTED":
      return "此媒体会话不支持该操作。";
    case "MEDIA_INVALID_CONTROL_REQUEST":
      return "媒体操作参数无效。";
    case "MEDIA_SESSION_NOT_FOUND":
      return "媒体会话已结束，请重新选择。";
    case "MEDIA_OPERATION_TIMED_OUT":
      return "媒体操作超时；请稍后查看播放状态。";
    case "MEDIA_CONTROL_FAILED":
      return "媒体应用未能执行该操作。";
    default:
      return "媒体操作失败；请稍后查看播放状态。";
  }
}

export function resolveCurrentMediaSession(
  snapshot: MediaSnapshot | null,
): MediaSession | null {
  if (!snapshot) return null;
  return (
    snapshot.sessions.find(
      (session) => session.sessionId === snapshot.currentSessionId,
    ) ?? null
  );
}

export function formatMediaPlaybackState(
  state: MediaPlaybackState | null,
): string {
  switch (state) {
    case "playing":
      return "正在播放";
    case "paused":
      return "已暂停";
    case "opened":
      return "已打开";
    case "changing":
      return "正在切换";
    case "stopped":
      return "已停止";
    case "closed":
      return "已关闭";
    default:
      return "状态未知";
  }
}

export function formatMediaModuleSummary(view: MediaViewState): string {
  if (view.error) return "媒体信息暂不可用";
  if (!view.snapshot) return "正在连接媒体";
  const session = resolveCurrentMediaSession(view.snapshot);
  if (!session) {
    return view.snapshot.health === "unavailable"
      ? "媒体服务暂不可用"
      : "暂无媒体播放";
  }
  const title = session.title?.trim();
  return title
    ? `${formatMediaPlaybackState(session.playbackState)} · ${title}`
    : formatMediaPlaybackState(session.playbackState);
}

export function formatMediaSourceLabel(
  sourceAppUserModelId: string | null,
  index: number,
): string {
  const source = sourceAppUserModelId?.toLocaleLowerCase() ?? "";
  if (source.includes("cloudmusic")) return "网易云音乐";
  if (source === "msedge" || source.includes("microsoftedge")) {
    return "Microsoft Edge";
  }
  return `媒体播放器 ${index + 1}`;
}

export function mediaProgress(
  session: MediaSession,
  observedAtMs: number,
  nowMs: number,
): MediaProgress | null {
  const { startMs, endMs, positionMs } = session.timeline;
  if (endMs === null || positionMs === null) return null;
  const start = startMs ?? 0;
  const durationMs = endMs - start;
  if (durationMs <= 0) return null;

  const elapsedSinceSnapshot =
    session.playbackState === "playing"
      ? Math.max(0, nowMs - observedAtMs)
      : 0;
  const position = Math.max(
    start,
    Math.min(endMs, positionMs + elapsedSinceSnapshot),
  );
  const currentMs = position - start;
  return {
    durationMs,
    currentMs,
    percentage: Math.max(0, Math.min(100, (currentMs / durationMs) * 100)),
  };
}

export function formatMediaTime(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) {
    return "--:--";
  }
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
      .toString()
      .padStart(2, "0");
    return `${hours}:${(minutes % 60).toString().padStart(2, "0")}:${seconds}`;
  }
  return `${minutes}:${seconds}`;
}

const SAFE_ARTWORK_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function mediaArtworkDataUrl(artwork: MediaArtwork): string | null {
  const contentType = artwork.contentType
    .split(";", 1)[0]
    ?.trim()
    .toLocaleLowerCase();
  if (!contentType || !SAFE_ARTWORK_TYPES.has(contentType)) return null;

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < artwork.bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...artwork.bytes.subarray(offset, offset + chunkSize),
    );
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}
