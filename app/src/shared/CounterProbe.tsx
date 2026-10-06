import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { counterBridge } from "./counter-bridge";
import {
  CounterSnapshotStore,
  parseIpcError,
  type IpcError,
} from "./counter-store";

const pageStyle = {
  boxSizing: "border-box" as const,
  position: "fixed" as const,
  inset: 0,
  overflow: "auto",
  padding: 28,
  color: "#17211d",
  background: "#f4f5f1",
  fontFamily: "Segoe UI, sans-serif",
};

const panelStyle = {
  boxSizing: "border-box" as const,
  width: "100%",
  maxWidth: 620,
  margin: "0 auto",
  padding: 24,
  border: "1px solid #d4dbd5",
  borderRadius: 18,
  background: "#fff",
  boxShadow: "0 12px 36px #1d322411",
};

const buttonStyle = {
  minHeight: 38,
  margin: "6px 8px 6px 0",
  padding: "8px 14px",
  border: "1px solid #bec9c1",
  borderRadius: 9,
  color: "#17211d",
  background: "#f6f8f5",
  cursor: "pointer",
};

export function CounterProbe() {
  const [consumerMounted, setConsumerMounted] = useState(true);
  const [result, setResult] = useState("等待 IPC 消费者启动");

  useEffect(() => {
    void (async () => {
      const window = getCurrentWindow();
      await window.setSize(new LogicalSize(660, 620));
      await window.show();
    })().catch((error: unknown) => setResult(`窗口初始化失败：${describeError(error)}`));
  }, []);

  return (
    <main style={pageStyle}>
      <section aria-label="G2-C 开发验证探针" style={panelStyle}>
        <p style={{ margin: "0 0 8px", color: "#5a695f", fontSize: 12, letterSpacing: 1.4 }}>
          G2-C · DEVELOPMENT PROBE
        </p>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>IPC 与模块生命周期</h1>
        <p style={{ margin: "0 0 18px", color: "#56645b", lineHeight: 1.5 }}>
          此页只在开发构建通过 <code>?g2c=ipc</code> 打开，不是产品模块。
        </p>

        {consumerMounted ? (
          <CounterConsumer
            onClosed={() => {
              setConsumerMounted(false);
              setResult("消费者已卸载；监听已注销，后台任务已停止");
            }}
            onResult={setResult}
          />
        ) : (
          <button style={buttonStyle} onClick={() => setConsumerMounted(true)} type="button">
            重新挂载消费者
          </button>
        )}

        <p aria-live="polite" role="status" style={{ minHeight: 24, color: "#3b5947" }}>
          {result}
        </p>
      </section>
    </main>
  );
}

function CounterConsumer({
  onClosed,
  onResult,
}: {
  onClosed: () => void;
  onResult: (result: string) => void;
}) {
  const [store] = useState(() => new CounterSnapshotStore());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [error, setError] = useState<IpcError | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const disconnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const disconnect = store.connect(counterBridge, setError);
    disconnectRef.current = disconnect;
    return () => {
      disconnect();
      disconnectRef.current = null;
    };
  }, [store]);

  const run = async (operation: () => Promise<unknown>, label: string) => {
    setBusy(true);
    setError(null);
    try {
      store.acceptCommandSnapshot(await operation());
      onResult(label);
    } catch (caught: unknown) {
      const parsed = parseIpcError(caught);
      setError(parsed);
      onResult(`${parsed.code}：${parsed.message}`);
    } finally {
      setBusy(false);
    }
  };

  const runCycles = async () => {
    setBusy(true);
    setError(null);
    try {
      for (let cycle = 0; cycle < 100; cycle += 1) {
        store.acceptCommandSnapshot(await counterBridge.enable());
        store.acceptCommandSnapshot(await counterBridge.disable());
      }
      onResult("100 次启用/禁用完成；每次禁用都等待后台线程退出");
    } catch (caught: unknown) {
      const parsed = parseIpcError(caught);
      setError(parsed);
      onResult(`${parsed.code}：${parsed.message}`);
    } finally {
      setBusy(false);
    }
  };

  const closeConsumer = async () => {
    setBusy(true);
    disconnectRef.current?.();
    try {
      store.acceptCommandSnapshot(await counterBridge.disable());
      onClosed();
    } catch (caught: unknown) {
      const parsed = parseIpcError(caught);
      setError(parsed);
      onResult(`${parsed.code}：${parsed.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div aria-label="计数器权威快照" style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 8,
        marginBottom: 16,
      }}>
        <Readout label="值" value={snapshot?.value ?? "—"} />
        <Readout label="revision" value={snapshot?.revision ?? "—"} />
        <Readout label="instanceId" value={snapshot?.instanceId || "—"} />
        <Readout label="后台任务" value={snapshot?.enabled ? "运行中" : "已停止"} />
      </div>

      <label style={{ display: "block", margin: "14px 0 6px", fontWeight: 600 }} htmlFor="counter-draft">
        界面编辑草稿（不属于后端快照）
      </label>
      <input
        id="counter-draft"
        aria-label="界面编辑草稿"
        onChange={(event) => setDraft(event.currentTarget.value)}
        style={{ boxSizing: "border-box", width: "100%", minHeight: 40, padding: 10, borderRadius: 8, border: "1px solid #cbd4cd" }}
        value={draft}
      />

      <div style={{ marginTop: 14 }}>
        <button disabled={busy} onClick={() => void run(counterBridge.enable, "计数器已启用")} style={buttonStyle} type="button">
          启用
        </button>
        <button disabled={busy} onClick={() => void run(counterBridge.disable, "计数器已禁用")} style={buttonStyle} type="button">
          禁用
        </button>
        <button disabled={busy} onClick={() => void runCycles()} style={buttonStyle} type="button">
          连续启停 100 次
        </button>
        <button
          disabled={busy}
          onClick={() => void closeConsumer()}
          style={buttonStyle}
          type="button"
        >
          关闭消费者
        </button>
      </div>

      {error ? (
        <p role="alert" style={{ color: "#9d3127" }}>
          {error.code}：{error.message}（{error.retryable ? "可重试" : "不可重试"}）
        </p>
      ) : null}
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ minWidth: 0, padding: "10px 12px", borderRadius: 10, background: "#f0f3ef" }}>
      <div style={{ marginBottom: 4, color: "#647267", fontSize: 12 }}>{label}</div>
      <div style={{ overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums", fontWeight: 650 }}>{value}</div>
    </div>
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "未知错误";
}
