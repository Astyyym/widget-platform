export type CounterSnapshot = {
  schemaVersion: number;
  revision: number;
  instanceId: string;
  value: number;
  enabled: boolean;
};

export type IpcError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type CounterChangedEvent = { snapshot: unknown };
export type Unlisten = () => void;

export interface CounterBridge {
  listen: (handler: (event: CounterChangedEvent) => void) => Promise<Unlisten>;
  snapshot: () => Promise<unknown>;
}

export function parseCounterSnapshot(value: unknown): CounterSnapshot {
  if (typeof value !== "object" || value === null) {
    throw ipcError("INVALID_COUNTER_SNAPSHOT", "计数器快照格式无效。", false);
  }
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.schemaVersion !== 1 ||
    !Number.isSafeInteger(snapshot.revision) ||
    (snapshot.revision as number) < 0 ||
    typeof snapshot.instanceId !== "string" ||
    typeof snapshot.value !== "number" ||
    !Number.isSafeInteger(snapshot.value) ||
    snapshot.value < 0 ||
    typeof snapshot.enabled !== "boolean"
  ) {
    throw ipcError("INVALID_COUNTER_SNAPSHOT", "计数器快照字段不符合协议。", false);
  }
  return snapshot as CounterSnapshot;
}

export function parseIpcError(value: unknown): IpcError {
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
  return ipcError("IPC_FAILURE", "计数器 IPC 调用失败。", true);
}

function ipcError(code: string, message: string, retryable: boolean): IpcError {
  return { code, message, retryable };
}

export class CounterSnapshotStore {
  private snapshot: CounterSnapshot | null = null;
  private readonly subscribers = new Set<() => void>();
  private connectionId = 0;
  private activeDisconnect: Unlisten | null = null;

  readonly getSnapshot = (): CounterSnapshot | null => this.snapshot;

  readonly subscribe = (subscriber: () => void): Unlisten => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  acceptCommandSnapshot(value: unknown): CounterSnapshot {
    const parsed = parseCounterSnapshot(value);
    this.acceptSnapshot(parsed);
    return parsed;
  }

  connect(bridge: CounterBridge, onError: (error: IpcError) => void): Unlisten {
    this.activeDisconnect?.();
    const connectionId = ++this.connectionId;
    let disposed = false;
    let synchronizing = true;
    let pending: CounterSnapshot | null = null;
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
          if (synchronizing) {
            try {
              const candidate = parseCounterSnapshot(event.snapshot);
              if (
                !pending ||
                candidate.instanceId !== pending.instanceId ||
                candidate.revision > pending.revision
              ) {
                pending = candidate;
              }
            } catch (error: unknown) {
              onError(parseIpcError(error));
            }
            return;
          }
          this.acceptEvent(event, onError);
        });
        if (disposed || this.connectionId !== connectionId) {
          stopListening();
          return;
        }
        unlisten = stopListening;

        const initial = await bridge.snapshot();
        if (disposed || this.connectionId !== connectionId) return;
        this.acceptCommandSnapshot(initial);
        if (pending) this.acceptEvent({ snapshot: pending }, onError);
        pending = null;
        synchronizing = false;
      } catch (error: unknown) {
        if (!disposed && this.connectionId === connectionId) {
          onError(parseIpcError(error));
          disconnect();
        }
      }
    })();

    return disconnect;
  }

  private acceptEvent(event: CounterChangedEvent, onError: (error: IpcError) => void): void {
    try {
      const candidate = parseCounterSnapshot(event.snapshot);
      if (!this.snapshot || candidate.instanceId !== this.snapshot.instanceId) return;
      if (candidate.revision > this.snapshot.revision) this.replace(candidate);
    } catch (error: unknown) {
      onError(parseIpcError(error));
    }
  }

  private acceptSnapshot(candidate: CounterSnapshot): void {
    if (!this.snapshot || candidate.instanceId !== this.snapshot.instanceId) {
      this.replace(candidate);
      return;
    }
    if (candidate.revision > this.snapshot.revision) this.replace(candidate);
  }

  private replace(candidate: CounterSnapshot): void {
    this.snapshot = candidate;
    for (const subscriber of this.subscribers) subscriber();
  }
}
