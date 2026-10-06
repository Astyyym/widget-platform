export type TodoItem = {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
  priorityOrder: number;
};

export type TodoSnapshot = {
  schemaVersion: number;
  revision: number;
  instanceId: string;
  items: TodoItem[];
};

export type TodoError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type TodoChangedEvent = { snapshot: unknown };
export type Unlisten = () => void;

export interface TodoBridge {
  listen: (handler: (event: TodoChangedEvent) => void) => Promise<Unlisten>;
  snapshot: () => Promise<unknown>;
  add: (actionId: string, text: string) => Promise<unknown>;
  setCompleted: (actionId: string, id: string, completed: boolean) => Promise<unknown>;
  delete: (actionId: string, id: string) => Promise<unknown>;
  reorder: (actionId: string, orderedIds: string[]) => Promise<unknown>;
}

function protocolError(code: string, message: string, retryable: boolean): TodoError {
  return { code, message, retryable };
}

export function parseTodoSnapshot(value: unknown): TodoSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw protocolError("INVALID_TODO_SNAPSHOT", "待办快照格式无效。", false);
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    !Number.isSafeInteger(candidate.revision) ||
    (candidate.revision as number) < 0 ||
    typeof candidate.instanceId !== "string" ||
    !Array.isArray(candidate.items)
  ) {
    throw protocolError("INVALID_TODO_SNAPSHOT", "待办快照字段不符合协议。", false);
  }
  const items = candidate.items.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw protocolError("INVALID_TODO_SNAPSHOT", "待办项目格式无效。", false);
    }
    const todo = item as Record<string, unknown>;
    if (
      typeof todo.id !== "string" ||
      typeof todo.text !== "string" ||
      typeof todo.completed !== "boolean" ||
      !Number.isSafeInteger(todo.createdAt) ||
      !Number.isSafeInteger(todo.updatedAt) ||
      !Number.isSafeInteger(todo.priorityOrder)
    ) {
      throw protocolError("INVALID_TODO_SNAPSHOT", "待办项目字段不符合协议。", false);
    }
    return {
      id: todo.id,
      text: todo.text,
      completed: todo.completed,
      createdAt: todo.createdAt as number,
      updatedAt: todo.updatedAt as number,
      priorityOrder: todo.priorityOrder as number,
    } satisfies TodoItem;
  });
  return {
    schemaVersion: 1,
    revision: candidate.revision as number,
    instanceId: candidate.instanceId,
    items,
  };
}

export function parseTodoError(value: unknown): TodoError {
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
  if (value instanceof Error) {
    return protocolError("TODO_IPC_FAILURE", value.message, true);
  }
  return protocolError("TODO_IPC_FAILURE", "待办操作失败，请重试。", true);
}

export type TodoSyncStatus = "idle" | "syncing" | "ready" | "failed";

const TODO_SYNC_RETRY_DELAY_MS = 5_000;

export class TodoSnapshotStore {
  private snapshot: TodoSnapshot | null = null;
  private syncStatus: TodoSyncStatus = "idle";
  private readonly subscribers = new Set<() => void>();
  private connectionId = 0;
  private activeDisconnect: Unlisten | null = null;

  readonly getSnapshot = (): TodoSnapshot | null => this.snapshot;
  readonly getSyncStatus = (): TodoSyncStatus => this.syncStatus;

  readonly subscribe = (subscriber: () => void): Unlisten => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  acceptCommandSnapshot(value: unknown): TodoSnapshot {
    const parsed = parseTodoSnapshot(value);
    this.acceptSnapshot(parsed);
    return parsed;
  }

  connect(
    bridge: Pick<TodoBridge, "listen" | "snapshot">,
    onError: (error: TodoError) => void,
  ): Unlisten {
    this.activeDisconnect?.();
    let disposed = false;
    let disconnectAttempt: Unlisten | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const disconnect = () => {
      if (disposed) return;
      disposed = true;
      if (this.activeDisconnect === disconnect) this.activeDisconnect = null;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      disconnectAttempt?.();
      disconnectAttempt = null;
      this.setSyncStatus("idle");
    };
    this.activeDisconnect = disconnect;

    const scheduleRetry = () => {
      if (disposed || retryTimer !== null) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connectAttempt();
      }, TODO_SYNC_RETRY_DELAY_MS);
    };

    const connectAttempt = () => {
      if (disposed) return;
      this.setSyncStatus("syncing");
      const connectionId = ++this.connectionId;
      let disposedAttempt = false;
      let synchronizing = true;
      let pending: TodoSnapshot | null = null;
      let unlisten: Unlisten | null = null;

      const stopAttempt = () => {
        if (disposedAttempt) return;
        disposedAttempt = true;
        if (this.connectionId === connectionId) this.connectionId += 1;
        unlisten?.();
        unlisten = null;
      };
      disconnectAttempt = stopAttempt;

      void (async () => {
        try {
          const stopListening = await bridge.listen((event) => {
            if (disposed || disposedAttempt || this.connectionId !== connectionId) return;
            try {
              const candidate = parseTodoSnapshot(event.snapshot);
              if (synchronizing) {
                if (
                  !pending ||
                  candidate.instanceId !== pending.instanceId ||
                  candidate.revision > pending.revision
                ) pending = candidate;
                return;
              }
              this.acceptEvent(candidate);
              this.setSyncStatus("ready");
            } catch (error: unknown) {
              const parsed = parseTodoError(error);
              onError(parsed);
              this.setSyncStatus("failed");
              if (parsed.retryable) {
                stopAttempt();
                scheduleRetry();
              }
            }
          });
          if (disposed || disposedAttempt || this.connectionId !== connectionId) {
            stopListening();
            return;
          }
          unlisten = stopListening;
          const initial = await bridge.snapshot();
          if (disposed || disposedAttempt || this.connectionId !== connectionId) return;
          this.acceptCommandSnapshot(initial);
          if (pending) this.acceptEvent(pending);
          pending = null;
          synchronizing = false;
          this.setSyncStatus("ready");
        } catch (error: unknown) {
          if (!disposed && !disposedAttempt && this.connectionId === connectionId) {
            const parsed = parseTodoError(error);
            onError(parsed);
            this.setSyncStatus("failed");
            stopAttempt();
            if (parsed.retryable) scheduleRetry();
          }
        }
      })();
    };

    connectAttempt();
    return disconnect;
  }

  private acceptEvent(candidate: TodoSnapshot): void {
    if (!this.snapshot || candidate.instanceId !== this.snapshot.instanceId) return;
    if (candidate.revision > this.snapshot.revision) this.replace(candidate);
  }

  private acceptSnapshot(candidate: TodoSnapshot): void {
    if (!this.snapshot || candidate.instanceId !== this.snapshot.instanceId) {
      this.replace(candidate);
      return;
    }
    if (candidate.revision > this.snapshot.revision) this.replace(candidate);
  }

  private replace(candidate: TodoSnapshot): void {
    this.snapshot = candidate;
    this.notifySubscribers();
  }

  private setSyncStatus(status: TodoSyncStatus): void {
    if (this.syncStatus === status) return;
    this.syncStatus = status;
    this.notifySubscribers();
  }

  private notifySubscribers(): void {
    for (const subscriber of this.subscribers) subscriber();
  }
}
