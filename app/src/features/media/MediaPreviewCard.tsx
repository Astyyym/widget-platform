import { LocalIcon } from "../../shell/LocalIcon";
import {
  formatMediaPlaybackState,
  formatMediaSourceLabel,
  resolveCurrentMediaSession,
} from "./media-panel-model";
import type { MediaViewState } from "./media-store";

type MediaPreviewCardProps = {
  view: MediaViewState;
};

/**
 * Compact, non-interactive media summary for the module hover popover.
 * Display-only: the popover is an aria-hidden tooltip, so playback controls
 * stay in the detail panel.
 */
export function MediaPreviewCard({ view }: MediaPreviewCardProps) {
  if (view.error) {
    return <p className="media-preview-empty">媒体信息暂不可用</p>;
  }
  const snapshot = view.snapshot;
  if (!snapshot) {
    return <p className="media-preview-empty">正在连接媒体</p>;
  }
  const session = resolveCurrentMediaSession(snapshot);
  if (!session) {
    return (
      <p className="media-preview-empty">
        {snapshot.health === "unavailable" ? "媒体服务暂不可用" : "暂无媒体播放"}
      </p>
    );
  }
  const index = snapshot.sessions.indexOf(session);
  const title = session.title?.trim() || "未知媒体";
  const artist = session.artist?.trim();
  return (
    <div className="media-preview">
      <div className="media-preview-head">
        <LocalIcon className="media-preview-icon" name="music" size={14} />
        <span className="media-preview-title">{title}</span>
      </div>
      {artist ? <span className="media-preview-artist">{artist}</span> : null}
      <span className="media-preview-meta">
        {formatMediaSourceLabel(session.sourceAppUserModelId, index)}
        {` · ${formatMediaPlaybackState(session.playbackState)}`}
      </span>
    </div>
  );
}
