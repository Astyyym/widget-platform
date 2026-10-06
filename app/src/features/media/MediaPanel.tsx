import { useEffect, useRef, useState, type RefObject } from "react";
import { LocalIcon, type IconName } from "../../shell/LocalIcon";
import {
  clampMediaSeekPosition,
  formatMediaPlaybackState,
  formatMediaSourceLabel,
  formatMediaTime,
  isMediaControlSupported,
  mediaControlFailureMessage,
  mediaArtworkDataUrl,
  mediaProgress,
} from "./media-panel-model";
import { mediaBridge } from "./media-bridge";
import type {
  MediaControlAction,
  MediaSession,
  MediaSnapshotStore,
  MediaViewState,
} from "./media-store";
import "./media-panel.css";

type MediaPanelProps = {
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  now: number;
  store: MediaSnapshotStore;
  view: MediaViewState;
  onClose: () => void;
};

function sessionOptionLabel(session: MediaSession, index: number): string {
  const source = formatMediaSourceLabel(session.sourceAppUserModelId, index);
  const title = session.title?.trim();
  return title ? `${source} · ${title}` : source;
}

function snapshotErrorMessage(error: string): string {
  switch (error) {
    case "accessDenied":
      return "系统拒绝读取媒体信息。";
    case "operationTimedOut":
      return "读取媒体信息超时。";
    case "providerUnavailable":
      return "媒体服务暂不可用。";
    default:
      return "媒体状态暂不可用；稍后会自动重试。";
  }
}

export function MediaPanel({
  closeButtonRef,
  now,
  store,
  view,
  onClose,
}: MediaPanelProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [pendingControl, setPendingControl] = useState(false);
  const [controlMessage, setControlMessage] = useState<string | null>(null);
  const [seekDraftMs, setSeekDraftMs] = useState<number | null>(null);
  const seekDraftRef = useRef<number | null>(null);
  const snapshot = view.snapshot;
  const sessions = snapshot?.sessions ?? [];
  const selectedSession =
    sessions.find((session) => session.sessionId === selectedSessionId) ??
    sessions.find((session) => session.sessionId === snapshot?.currentSessionId) ??
    sessions[0] ??
    null;
  const selectedIndex = selectedSession
    ? sessions.indexOf(selectedSession)
    : -1;

  useEffect(() => {
    let cancelled = false;
    setArtworkUrl(null);
    const reference = selectedSession?.artworkRef;
    if (!reference) {
      return () => {
        cancelled = true;
      };
    }

    void store
      .readArtwork(mediaBridge, reference)
      .then(mediaArtworkDataUrl)
      .then((url) => {
        if (!cancelled) setArtworkUrl(url);
      })
      .catch(() => {
        if (!cancelled) setArtworkUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSession?.artworkRef, store]);

  const progress =
    selectedSession && snapshot
      ? mediaProgress(selectedSession, snapshot.observedAtMs, now)
      : null;

  useEffect(() => {
    seekDraftRef.current = null;
    setSeekDraftMs(null);
    setControlMessage(null);
  }, [selectedSession?.sessionId]);

  const sendControl = async (
    action: MediaControlAction,
    positionMs?: number,
  ) => {
    if (!selectedSession || pendingControl) return;
    setPendingControl(true);
    setControlMessage(null);
    try {
      const accepted = await mediaBridge.control(
        selectedSession.sessionId,
        action,
        positionMs,
      );
      setControlMessage(
        accepted ? "媒体应用已接受请求。" : "媒体应用未接受此次请求。",
      );
    } catch (error) {
      setControlMessage(mediaControlFailureMessage(error));
    } finally {
      setPendingControl(false);
    }
  };

  const updateSeekDraft = (value: number) => {
    seekDraftRef.current = value;
    setSeekDraftMs(value);
  };

  const commitSeek = () => {
    const draft = seekDraftRef.current;
    seekDraftRef.current = null;
    setSeekDraftMs(null);
    if (draft === null || !progress) return;
    const clamped = clampMediaSeekPosition(draft, progress.durationMs);
    if (clamped !== null) void sendControl("seek", clamped);
  };

  const controlButton = (
    action: Exclude<MediaControlAction, "seek">,
    label: string,
    iconName: IconName,
    supported: boolean,
  ) => (
    <button
      aria-label={label}
      className="media-control-button"
      disabled={pendingControl || !supported}
      key={action}
      onClick={() => void sendControl(action)}
      title={label}
      type="button"
    >
      <LocalIcon name={iconName} size={20} />
    </button>
  );

  return (
    <>
      <header>
        <div>
          <span>当前媒体</span>
          <h1>媒体</h1>
        </div>
        <button
          aria-label="关闭详情"
          className="shell-panel-close"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          <LocalIcon name="x" size={16} />
        </button>
      </header>

      {sessions.length > 1 ? (
        <label className="media-session-picker">
          <span>选择会话</span>
          <select
            aria-label="选择媒体会话"
            disabled={pendingControl}
            onChange={(event) => setSelectedSessionId(event.target.value)}
            value={selectedSession?.sessionId ?? ""}
          >
            {sessions.map((session, index) => (
              <option key={session.sessionId} value={session.sessionId}>
                {sessionOptionLabel(session, index)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {view.error ? (
        <p className="media-status-message" role="status">
          {view.error}
        </p>
      ) : !snapshot ? (
        <p className="media-status-message" role="status">
          正在读取媒体会话…
        </p>
      ) : sessions.length === 0 ? (
        <div className="media-empty-state" role="status">
          <span aria-hidden="true"><LocalIcon name="music" size={28} /></span>
          <strong>没有可显示的媒体会话</strong>
          <p>
            {snapshot.error
              ? snapshotErrorMessage(snapshot.error)
              : "播放媒体后，标题和播放进度会显示在这里。"}
          </p>
        </div>
      ) : selectedSession ? (
        <div className="media-session-content">
          {snapshot.health === "partial" || selectedSession.quality === "partial" ? (
            <p className="media-status-message" role="status">
              部分媒体信息暂不可用。
            </p>
          ) : null}
          <div className="media-now-playing">
            <div className="media-artwork-frame">
              {artworkUrl ? (
                <img
                  alt="媒体封面"
                  className="media-artwork"
                  src={artworkUrl}
                />
              ) : (
                <span aria-hidden="true" className="media-artwork-placeholder">
                  <LocalIcon name="music" size={40} />
                </span>
              )}
            </div>
            <div className="media-track-copy">
              <strong>{selectedSession.title?.trim() || "未知媒体"}</strong>
              <span>{selectedSession.artist?.trim() || "未知艺术家"}</span>
              {selectedSession.albumTitle?.trim() ? (
                <span>{selectedSession.albumTitle.trim()}</span>
              ) : null}
              <small>
                {formatMediaSourceLabel(
                  selectedSession.sourceAppUserModelId,
                  selectedIndex,
                )}
                {` · ${formatMediaPlaybackState(selectedSession.playbackState)}`}
              </small>
            </div>
          </div>

          <div className="media-progress-section">
            {progress ? (
              <>
                <input
                  aria-label="媒体播放进度"
                  aria-valuetext={`${formatMediaTime(seekDraftMs ?? progress.currentMs)} / ${formatMediaTime(progress.durationMs)}`}
                  className="media-seek-range"
                  disabled={
                    pendingControl ||
                    !isMediaControlSupported(selectedSession, "seek")
                  }
                  max={progress.durationMs}
                  min={0}
                  onBlur={commitSeek}
                  onChange={(event) =>
                    updateSeekDraft(Number(event.currentTarget.value))
                  }
                  onKeyUp={commitSeek}
                  onPointerUp={commitSeek}
                  step={1_000}
                  type="range"
                  value={seekDraftMs ?? progress.currentMs}
                />
                <div className="media-progress-times">
                  <span>{formatMediaTime(seekDraftMs ?? progress.currentMs)}</span>
                  <span>{formatMediaTime(progress.durationMs)}</span>
                </div>
                {!isMediaControlSupported(selectedSession, "seek") ? (
                  <p className="media-status-message">此媒体会话不支持跳转。</p>
                ) : null}
              </>
            ) : (
              <p className="media-status-message">
                播放进度暂不可用。
                {selectedSession.capabilities.canSeek === false
                  ? " 此媒体会话不支持跳转。"
                  : ""}
              </p>
            )}
          </div>

          <div aria-label="媒体控制" className="media-controls" role="group">
            {controlButton(
              "previous",
              "上一首",
              "skip-back",
              isMediaControlSupported(selectedSession, "previous"),
            )}
            {(() => {
              const isPlaying = selectedSession.playbackState === "playing";
              const action: MediaControlAction = isPlaying ? "pause" : "play";
              const label = isPlaying ? "暂停" : "播放";
              return controlButton(
                action,
                label,
                isPlaying ? "pause" : "play",
                isMediaControlSupported(selectedSession, action),
              );
            })()}
            {controlButton(
              "next",
              "下一首",
              "skip-forward",
              isMediaControlSupported(selectedSession, "next"),
            )}
          </div>
          {pendingControl || controlMessage ? (
            <p aria-live="polite" className="media-status-message" role="status">
              {pendingControl ? "正在发送媒体控制请求…" : controlMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      <footer>
        <span aria-hidden="true" />按 Esc 或返回按钮回到摘要
      </footer>
    </>
  );
}
