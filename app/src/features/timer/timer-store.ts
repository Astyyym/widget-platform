export type TimerPhase = "focus" | "break";
export type TimerStateKind = "idle" | "running" | "paused" | "completed";

export type TimerSnapshot = {
  schemaVersion: number;
  revision: number;
  instanceId: string;
  phase: TimerPhase;
  state: TimerStateKind;
  durationMs: number;
  remainingMs: number;
  deadlineUtc: number | null;
  generation: number;
  completionId: string | null;
  clockAnomaly: boolean;
};

export type TimerError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type TimerChangedEvent = { snapshot: unknown };
export type Unlisten = () => void;

export interface TimerBridge {
  listen: (handler: (event: TimerChangedEvent) => void) => Promise<Unlisten>;
  snapshot: () => Promise<unknown>;
  start: (
    actionId: string,
    phase: TimerPhase,
    durationMs: number,
  ) => Promise<unknown>;
  pause: (actionId: string) => Promise<unknown>;
  resume: (actionId: string) => Promise<unknown>;
  reset: (actionId: string, durationMs?: number) => Promise<unknown>;
  expire: (actionId: string, generation: number) => Promise<unknown>;
}

function protocolError(
  code: string,
  message: string,
  retryable: boolean,
): TimerError {
  return { code, message, retryable };
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseTimerSnapshot(value: unknown): TimerSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw protocolError(
      "INVALID_TIMER_SNAPSHOT",
      "计时器快照格式无效。",
      false,
    );
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    !isSafeNonNegativeInteger(candidate.revision) ||
    typeof candidate.instanceId !== "string" ||
    !["focus", "break"].includes(candidate.phase as string) ||
    !["idle", "running", "paused", "completed"].includes(
      candidate.state as string,
    ) ||
    !isSafeNonNegativeInteger(candidate.durationMs) ||
    !isSafeNonNegativeInteger(candidate.remainingMs) ||
    (candidate.deadlineUtc !== null &&
      !isSafeNonNegativeInteger(candidate.deadlineUtc)) ||
    !isSafeNonNegativeInteger(candidate.generation) ||
    (candidate.completionId !== null &&
      typeof candidate.completionId !== "string") ||
    typeof candidate.clockAnomaly !== "boolean"
  ) {
    throw protocolError(
      "INVALID_TIMER_SNAPSHOT",
      "计时器快照字段不符合协议。",
      false,
    );
  }
  return {
    schemaVersion: 1,
    revision: candidate.revision,
    instanceId: candidate.instanceId,
    phase: candidate.phase as TimerPhase,
    state: candidate.state as TimerStateKind,
    durationMs: candidate.durationMs,
    remainingMs: candidate.remainingMs,
    deadlineUtc: candidate.deadlineUtc as number | null,
    generation: candidate.generation,
    completionId: candidate.completionId as string | null,
    clockAnomaly: candidate.clockAnomaly,
  };
}

export function parseTimerError(value: unknown): TimerError {
  if (typeof value === "object" && value !== null) {
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.code === "string" &&
      typeof candidate.message === "string" &&
      typeof candidate.retryable === "boolean"
    ) {
      return {
        code: candidate.code,
        message: candidate.message,
        retryable: candidate.retryable,
      };
    }
  }
  if (value instanceof Error)
    return protocolError("TIMER_IPC_FAILURE", value.message, true);
  return protocolError("TIMER_IPC_FAILURE", "计时器操作失败，请重试。", true);
}

export class TimerSnapshotStore {
  private snapshot: TimerSnapshot | null = null;
  private readonly subscribers = new Set<() => void>();
  private connectionId = 0;
  private activeDisconnect: Unlisten | null = null;

  readonly getSnapshot = (): TimerSnapshot | null => this.snapshot;

  readonly subscribe = (subscriber: () => void): Unlisten => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  acceptCommandSnapshot(value: unknown): TimerSnapshot {
    const parsed = parseTimerSnapshot(value);
    this.acceptSnapshot(parsed);
    return parsed;
  }

  connect(
    bridge: Pick<TimerBridge, "listen" | "snapshot">,
    onError: (error: TimerError) => void,
  ): Unlisten {
    this.activeDisconnect?.();
    const connectionId = ++this.connectionId;
    let disposed = false;
    let synchronizing = true;
    let pending: TimerSnapshot | null = null;
    let unlisten: Unlisten | null = null;

    const disconnect = () => {
      if (disposed) return;
      disposed = true;
      if (this.connectionId === connectionId) this.connectionId += 1;
      if (this.activeDisconnect === disconnect) this.activeDisconnect = null;
      unlisten?.();
      unlisten = null;
    };
    this.activeDisconnect = disconnect;

    void (async () => {
      try {
        const stopListening = await bridge.listen((event) => {
          if (disposed || this.connectionId !== connectionId) return;
          try {
            const candidate = parseTimerSnapshot(event.snapshot);
            if (synchronizing) {
              if (
                !pending ||
                candidate.instanceId !== pending.instanceId ||
                candidate.revision > pending.revision
              )
                pending = candidate;
              return;
            }
            this.acceptEvent(candidate);
          } catch (error: unknown) {
            onError(parseTimerError(error));
          }
        });
        if (disposed || this.connectionId !== connectionId) {
          stopListening();
          return;
        }
        unlisten = stopListening;
        const initial = await bridge.snapshot();
        if (disposed || this.connectionId !== connectionId) return;
        this.acceptCommandSnapshot(initial);
        if (pending) this.acceptEvent(pending);
        pending = null;
        synchronizing = false;
      } catch (error: unknown) {
        if (!disposed && this.connectionId === connectionId) {
          onError(parseTimerError(error));
          disconnect();
        }
      }
    })();

    return disconnect;
  }

  private acceptEvent(candidate: TimerSnapshot): void {
    if (!this.snapshot || candidate.instanceId !== this.snapshot.instanceId)
      return;
    if (candidate.revision > this.snapshot.revision) this.replace(candidate);
  }

  private acceptSnapshot(candidate: TimerSnapshot): void {
    if (!this.snapshot || candidate.instanceId !== this.snapshot.instanceId) {
      this.replace(candidate);
      return;
    }
    if (candidate.revision > this.snapshot.revision) this.replace(candidate);
  }

  private replace(candidate: TimerSnapshot): void {
    this.snapshot = candidate;
    for (const subscriber of this.subscribers) subscriber();
  }
}
