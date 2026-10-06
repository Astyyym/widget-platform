import { useEffect, useState, type RefObject } from "react";
import { LocalIcon } from "../../shell/LocalIcon";
import type { ClipboardEntry } from "./clipboard-model";
import { ClipboardSnapshotStore } from "./clipboard-store";
import "./clipboard-panel.css";

type ClipboardPanelProps = {
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  store: ClipboardSnapshotStore;
  onClose: () => void;
};

function actionId(): string {
  return `clipboard-ui-copy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatEntryTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "时间不可用";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function ClipboardPanel({ closeButtonRef, store, onClose }: ClipboardPanelProps) {
  const [state, setState] = useState(() => store.getState());
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const unsubscribe = store.subscribe(() => setState(store.getState()));
    setState(store.getState());
    return unsubscribe;
  }, [store]);

  useEffect(() => {
    void store.refreshPage(offset, 100);
  }, [offset, store]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void store.refreshPage(offset, 100);
    }, 750);
    return () => window.clearInterval(timer);
  }, [offset, store]);

  const snapshot = state.snapshot;
  const entries = snapshot?.entries ?? [];
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
    } finally {
      setBusy(false);
    }
  };
  const copy = (entry: ClipboardEntry) =>
    void run(() => store.copy(entry.id, actionId()));
  const deleteEntry = (entry: ClipboardEntry) =>
    void run(() => store.deleteEntry(entry.id));
  const clearAll = () => void run(() => store.clearAll());

  return (
    <section aria-label="剪贴板历史活动面板" className="clipboard-panel" role="dialog">
      <header>
        <div>
          <span>纯文本 · 本机存储</span>
          <h1>剪贴板历史</h1>
        </div>
        <button aria-label="关闭详情" className="shell-panel-close" onClick={onClose} ref={closeButtonRef} type="button"><LocalIcon name="x" size={16} /></button>
      </header>

      {state.failure ? <p aria-live="assertive" className="clipboard-error" role="alert">{state.failure}</p> : null}
      {snapshot?.error ? <p className="clipboard-error" role="status">监听暂不可用；新的文本不会写入历史。</p> : null}

      {entries.length === 0 ? (
        <div className="clipboard-empty" role="status">
          <strong>还没有剪贴板历史</strong>
          <p>显示此模块后会记录新的纯文本；图片、文件和富文本不会进入这一版。</p>
        </div>
      ) : (
        <div aria-label="剪贴板历史列表" className="clipboard-list" role="list">
          {entries.map((entry) => (
            <article className="clipboard-entry" key={entry.id} role="listitem">
              <p>{entry.text}</p>
              <div className="clipboard-entry-meta">
                <span>{formatEntryTime(entry.createdAtMs)}{entry.sourceAppId ? ` · ${entry.sourceAppId}` : ""}</span>
                <div className="clipboard-entry-actions">
                  <button aria-label={`复制到剪贴板：${entry.text}`} onClick={() => copy(entry)} type="button">复制</button>
                  <button aria-label={`删除：${entry.text}`} onClick={() => deleteEntry(entry)} type="button">删除</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <footer className="clipboard-footer">
        <span className="clipboard-history-count">{snapshot ? `${snapshot.totalEntries} 条历史` : "尚未读取历史"}</span>
        <button disabled={busy || !snapshot || snapshot.totalEntries === 0} onClick={clearAll} type="button">清空全部</button>
        {snapshot && snapshot.totalEntries > entries.length ? (
          <div className="clipboard-pagination">
            <button disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))} type="button">上一页</button>
            <button disabled={busy || offset + entries.length >= snapshot.totalEntries} onClick={() => setOffset(offset + 100)} type="button">下一页</button>
          </div>
        ) : null}
      </footer>
    </section>
  );
}
