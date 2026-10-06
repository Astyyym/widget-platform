import type { Ref } from "react";
import { LocalIcon } from "../../shell/LocalIcon";
import {
  describeCodexQuotaFailure,
  formatCodexQuotaSummary,
  type CodexQuotaBucket,
  type CodexQuotaState,
  type CodexQuotaWindow,
} from "./codex-quota-model";
import "./codex-panel.css";

type CodexPanelProps = {
  state: CodexQuotaState;
  isRefreshing?: boolean;
  closeButtonRef: Ref<HTMLButtonElement>;
  onClose: () => void;
};

function formatWindowDuration(minutes: number | null): string {
  if (minutes === null) return "时长未知";
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const remainder = minutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (remainder > 0 || parts.length === 0) parts.push(`${remainder}分钟`);
  return parts.join("");
}

function formatLocalTime(timestampMs: number | null): string {
  if (timestampMs === null) return "未提供";
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return "时间不可用";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function QuotaWindowRow({
  label,
  value,
}: {
  label: string;
  value: CodexQuotaWindow | null;
}) {
  return (
    <div className="codex-quota-window">
      <dt>
        {label}
        {value ? ` · ${formatWindowDuration(value.windowDurationMinutes)}` : ""}
      </dt>
      <dd>
        {value ? `${value.usedPercent}% 已用` : "额度数据未提供"}
        {value ? <div aria-label="Codex额度已用进度" className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, value.usedPercent)}><span style={{ width: `${Math.min(100, value.usedPercent)}%` }} /></div> : null}
        {value ? (
          <span>重置时间：{formatLocalTime(value.resetsAtMs)}</span>
        ) : null}
      </dd>
    </div>
  );
}

function BucketSection({
  title,
  bucket,
}: {
  title: string;
  bucket: CodexQuotaBucket;
}) {
  return (
    <section className="codex-quota-section">
      <h2>{title}</h2>
      <dl className="codex-quota-window-list">
        <QuotaWindowRow label="主窗口" value={bucket.primary} />
        <QuotaWindowRow label="次窗口" value={bucket.secondary} />
      </dl>
    </section>
  );
}

export function CodexPanel({
  state,
  isRefreshing = false,
  closeButtonRef,
  onClose,
}: CodexPanelProps) {
  const snapshot = state.snapshot;
  const statusMessage =
    isRefreshing
      ? snapshot
        ? `正在更新 · ${formatCodexQuotaSummary(state)}`
        : "正在读取 Codex 额度"
      : state.quality === "fresh"
        ? `数据已更新 · ${formatCodexQuotaSummary(state)}`
        : formatCodexQuotaSummary(state);
  const observationLabel = state.quality === "stale" ? "上次成功读取" : "更新时间";
  const observationTime = formatLocalTime(snapshot?.observedAtMs ?? null);
  const observationText = snapshot
    ? `${observationLabel}：${observationTime}`
    : state.lastAttemptAtMs === null
      ? "尚未发起读取"
      : `最近尝试：${formatLocalTime(state.lastAttemptAtMs)}`;

  return (
    <>
      <header>
        <div>
          <span>官方只读数据</span>
          <h1>Codex 额度</h1>
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

      <p
        aria-busy={isRefreshing || undefined}
        className="codex-quota-status"
        data-quality={state.quality}
        role="status"
      >
        {statusMessage}
      </p>
      {state.quality === "stale" ? (
        <p className="codex-quota-error">
          本次读取失败：{describeCodexQuotaFailure(state.failureReason)}；保留上次成功数据。
        </p>
      ) : null}

      {snapshot ? (
        <>
          {snapshot.coreBucket ? (
            <BucketSection title="核心额度" bucket={snapshot.coreBucket} />
          ) : (
            <section className="codex-quota-section">
              <h2>核心额度</h2>
              <p className="codex-quota-empty">
                响应未提供 Codex 核心 bucket；其他额度桶不会作为替代。
              </p>
            </section>
          )}
          {snapshot.otherBuckets.length > 0 ? (
            <section className="codex-quota-section">
              <h2>其他额度桶</h2>
              {snapshot.otherBuckets.map((bucket) => (
                <BucketSection
                  bucket={bucket}
                  key={bucket.id}
                  title={bucket.id}
                />
              ))}
            </section>
          ) : null}
        </>
      ) : (
        <p className="codex-quota-empty">
          当前没有可用额度数据；不会展示估算百分比。
        </p>
      )}

      <footer className="codex-quota-footer">
        <span aria-hidden="true" />
        来源：Codex app-server · {observationText}
      </footer>
    </>
  );
}
