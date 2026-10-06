import { useEffect, useRef, useState, type RefObject } from "react";
import { LocalIcon } from "../../shell/LocalIcon";
import { timerBridge } from "./timer-bridge";
import { notifyTimerCompletion } from "./timer-notifications";
import { timerCountdownProgress } from "./timer-progress";
import {
  parseTimerError,
  TimerSnapshotStore,
  type TimerError,
  type TimerPhase,
  type TimerSnapshot,
} from "./timer-store";
import "./timer-panel.css";

type TimerPanelProps = {
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  isFixture?: boolean;
};

const DEFAULT_MINUTES: Record<TimerPhase, number> = { focus: 25, break: 5 };

function actionId(prefix: string): string {
  return `timer-ui-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function visibleRemaining(snapshot: TimerSnapshot | null, now: number): number {
  if (!snapshot) return 0;
  if (
    snapshot.state === "running" &&
    snapshot.deadlineUtc !== null &&
    !snapshot.clockAnomaly
  ) {
    return Math.max(0, snapshot.deadlineUtc - now);
  }
  return snapshot.remainingMs;
}

export function TimerPanel({
  closeButtonRef,
  onClose,
  isFixture = false,
}: TimerPanelProps) {
  const storeRef = useRef<TimerSnapshotStore | null>(null);
  if (!storeRef.current) storeRef.current = new TimerSnapshotStore();
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(
    () => storeRef.current?.getSnapshot() ?? null,
  );
  const [phase, setPhase] = useState<TimerPhase>("focus");
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES.focus);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<TimerError | null>(null);
  const notifiedCompletion = useRef<string | null>(null);
  const expirationInFlight = useRef<number | null>(null);

  useEffect(() => {
    if (isFixture) return;
    const store = storeRef.current!;
    const unsubscribe = store.subscribe(() => {
      const next = store.getSnapshot();
      setSnapshot(next);
      if (next?.phase) setPhase(next.phase);
    });
    const disconnect = store.connect(timerBridge, setFailure);
    return () => {
      unsubscribe();
      disconnect();
    };
  }, [isFixture]);

  useEffect(() => {
    if (isFixture || snapshot?.state !== "running") return;
    const tick = () => setNow(Date.now());
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [isFixture, snapshot?.state, snapshot?.deadlineUtc]);

  useEffect(() => {
    if (
      isFixture ||
      snapshot?.state !== "running" ||
      snapshot.deadlineUtc === null
    )
      return;
    const generation = snapshot.generation;
    const deadline = snapshot.deadlineUtc;
    const checkDeadline = () => {
      const current = Date.now();
      setNow(current);
      if (current < deadline || expirationInFlight.current === generation)
        return;
      expirationInFlight.current = generation;
      void timerBridge
        .expire(actionId("expire"), generation)
        .then((value) => {
          storeRef.current?.acceptCommandSnapshot(value);
          setSnapshot(storeRef.current?.getSnapshot() ?? null);
        })
        .catch((error: unknown) => {
          expirationInFlight.current = null;
          setFailure(parseTimerError(error));
        });
    };
    checkDeadline();
    const interval = window.setInterval(checkDeadline, 500);
    return () => window.clearInterval(interval);
  }, [isFixture, snapshot?.deadlineUtc, snapshot?.generation, snapshot?.state]);

  useEffect(() => {
    if (
      snapshot?.state !== "completed" ||
      !snapshot.completionId ||
      notifiedCompletion.current === snapshot.completionId
    )
      return;
    notifiedCompletion.current = snapshot.completionId;
    notifyTimerCompletion(snapshot);
  }, [snapshot]);

  const runMutation = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await operation();
      storeRef.current!.acceptCommandSnapshot(result);
      setSnapshot(storeRef.current!.getSnapshot());
    } catch (error: unknown) {
      setFailure(parseTimerError(error));
    } finally {
      setBusy(false);
    }
  };

  const durationMs = Math.round(minutes * 60 * 1000);
  const remaining = visibleRemaining(snapshot, now);
  const state = snapshot?.state ?? "idle";
  const canStart =
    !busy && !isFixture && (state === "idle" || state === "completed");
  const canPause = !busy && !isFixture && state === "running";
  const canResume = !busy && !isFixture && state === "paused";
  const usedProgress = snapshot ? 100 - (timerCountdownProgress(snapshot, now) ?? 0) : 0;

  if (isFixture) {
    return (
      <section aria-label="计时活动面板" className="timer-panel" role="dialog">
        <TimerPanelHeader closeButtonRef={closeButtonRef} onClose={onClose} />
        <div className="timer-display" aria-label="示例计时 25 分钟">
          25:00
        </div>
        <div aria-label="计时已用进度" className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}><span style={{ width: "0%" }} /></div>
        <p className="timer-panel-copy">
          隔离 UI 样例：专注与休息阶段的计时控制。
        </p>
      </section>
    );
  }

  return (
    <section aria-label="计时活动面板" className="timer-panel" role="dialog">
      <TimerPanelHeader closeButtonRef={closeButtonRef} onClose={onClose} />
      <div className="timer-phase-switch" role="group" aria-label="计时阶段">
        <button
          className={phase === "focus" ? "is-selected" : ""}
          disabled={state === "running" || state === "paused"}
          onClick={() => {
            setPhase("focus");
            setMinutes(DEFAULT_MINUTES.focus);
          }}
          type="button"
        >
          专注
        </button>
        <button
          className={phase === "break" ? "is-selected" : ""}
          disabled={state === "running" || state === "paused"}
          onClick={() => {
            setPhase("break");
            setMinutes(DEFAULT_MINUTES.break);
          }}
          type="button"
        >
          休息
        </button>
      </div>
      <div aria-live="polite" className={`timer-display timer-state-${state}`}>
        {formatRemaining(remaining)}
      </div>
      <p className="timer-status">
        {state === "running"
          ? "进行中"
          : state === "paused"
            ? "已暂停"
            : state === "completed"
              ? "已完成"
              : "待开始"}{" "}
        · {phase === "focus" ? "专注" : "休息"}
      </p>
      <div aria-label="计时已用进度" className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedProgress)}><span style={{ width: `${usedProgress}%` }} /></div>
      {state !== "running" && state !== "paused" ? (
        <label className="timer-duration">
          时长（分钟）
          <input
            aria-label="计时分钟数"
            min="1"
            max="10080"
            onChange={(event) =>
              setMinutes(
                Math.max(1, Math.min(10080, Number(event.target.value) || 1)),
              )
            }
            type="number"
            value={minutes}
          />
        </label>
      ) : null}
      {failure ? (
        <p aria-live="assertive" className="timer-error" role="alert">
          {failure.message}
        </p>
      ) : null}
      {snapshot?.clockAnomaly ? (
        <p aria-live="polite" className="timer-warning">
          系统时钟发生变化，已保留最近可信剩余时间；继续计时会重新校准。
        </p>
      ) : null}
      <div className="timer-actions">
        {state === "running" ? (
          <button
            disabled={!canPause}
            onClick={() => void runMutation(() => timerBridge.pause(actionId("pause")))}
            type="button"
          >
            暂停
          </button>
        ) : state === "paused" ? (
          <button
            disabled={!canResume}
            onClick={() => void runMutation(() => timerBridge.resume(actionId("resume")))}
            type="button"
          >
            继续
          </button>
        ) : (
          <button
            disabled={!canStart}
            onClick={() => void runMutation(() => timerBridge.start(actionId("start"), phase, durationMs))}
            type="button"
          >
            {state === "completed" ? "重新开始" : "开始"}
          </button>
        )}

        <button
          disabled={busy || !snapshot}
          onClick={() =>
            void runMutation(() =>
              timerBridge.reset(actionId("reset"), durationMs),
            )
          }
          type="button"
        >
          重置
        </button>
      </div>
      {state === "completed" ? (
        <p aria-live="polite" className="timer-completion">
          本阶段已完成。面板反馈可用；系统通知需由系统权限允许。
        </p>
      ) : null}
      <footer className="timer-panel-footer">
        <span aria-hidden="true" />
        {snapshot ? `已保存 · 修订 ${snapshot.revision}` : "正在同步"}
      </footer>
    </section>
  );
}

function TimerPanelHeader({
  closeButtonRef,
  onClose,
}: Pick<TimerPanelProps, "closeButtonRef" | "onClose">) {
  return (
    <header>
      <div>
        <span>活动面板</span>
        <h1>计时</h1>
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
  );
}
