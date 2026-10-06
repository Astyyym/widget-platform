import type { CodexQuotaBridge } from "./codex-bridge";
import {
  applyCodexQuotaFailure,
  classifyCodexQuotaCommandError,
  createCodexQuotaFreshState,
  parseCodexQuotaCommandError,
  parseCodexQuotaCommandResponse,
  type CodexQuotaFailureReason,
  type CodexQuotaState,
} from "./codex-quota-model";

export const CODEX_QUOTA_REFRESH_INTERVAL_MS = 3 * 60_000;
const CODEX_QUOTA_BUSY_RETRY_MS = 1_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

type CodexQuotaStoreState = {
  quota: CodexQuotaState;
  isRefreshing: boolean;
};

type Connection = {
  bridge: CodexQuotaBridge;
  consumers: number;
  timer: ReturnType<typeof setTimeout> | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
  pending: boolean;
  generation: number;
};

type Subscriber = () => void;
export type Unsubscribe = () => void;

export type CodexQuotaVisibility = {
  isFixture: boolean;
  documentVisible: boolean;
  moduleEnabled: boolean;
  panelActive: boolean;
  hidden: boolean;
  settingsOpen: boolean;
};

export function shouldConnectCodexQuota(
  visibility: CodexQuotaVisibility,
): boolean {
  return !visibility.isFixture && visibility.moduleEnabled;
}

const INITIAL_CODEX_QUOTA_STATE: CodexQuotaState = {
  quality: "unavailable",
  snapshot: null,
  failureReason: "notConnected",
  lastAttemptAtMs: null,
};

export class CodexQuotaStore {
  private state: CodexQuotaStoreState = {
    quota: INITIAL_CODEX_QUOTA_STATE,
    isRefreshing: false,
  };
  private readonly subscribers = new Set<Subscriber>();
  private connection: Connection | null = null;
  private nextRefreshAtMs = 0;

  readonly getState = (): CodexQuotaStoreState => this.state;

  readonly subscribe = (subscriber: Subscriber): Unsubscribe => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  connect(bridge: CodexQuotaBridge): Unsubscribe {
    let connection = this.connection;
    if (!connection) {
      connection = {
        bridge,
        consumers: 0,
        timer: null,
        stopTimer: null,
        pending: false,
        generation: 0,
      };
      this.connection = connection;
    }

    if (connection.stopTimer !== null) {
      clearTimeout(connection.stopTimer);
      connection.stopTimer = null;
    }
    connection.consumers += 1;
    if (connection.consumers === 1) this.refreshOrSchedule(connection);

    let disconnected = false;
    return () => {
      if (disconnected) return;
      disconnected = true;
      if (this.connection !== connection) return;
      connection!.consumers = Math.max(0, connection!.consumers - 1);
      if (connection!.consumers === 0) {
        if (connection!.timer !== null) clearTimeout(connection!.timer);
        connection!.timer = null;
        // Deferring the stop lets React StrictMode immediately reconnect effects
        // without cancelling the same request during its development-only replay.
        connection!.stopTimer = setTimeout(() => {
          this.stopConnection(connection!);
        }, 0);
      }
    };
  }

  private stopConnection(connection: Connection): void {
    connection.stopTimer = null;
    if (this.connection !== connection || connection.consumers > 0) return;
    if (connection.pending) {
      this.nextRefreshAtMs = Math.max(
        this.nextRefreshAtMs,
        Date.now() + CODEX_QUOTA_REFRESH_INTERVAL_MS,
      );
      connection.generation += 1;
      this.replaceState({ quota: this.state.quota, isRefreshing: false });
      void connection.bridge.cancel().catch(() => undefined);
      return;
    }
    this.connection = null;
  }

  private refreshOrSchedule(connection: Connection): void {
    if (
      this.connection !== connection ||
      connection.consumers === 0 ||
      connection.pending
    ) {
      return;
    }

    const delay = this.nextRefreshAtMs - Date.now();
    if (delay > 0) {
      connection.timer = setTimeout(() => {
        connection.timer = null;
        this.refreshOrSchedule(connection);
      }, Math.min(delay, MAX_TIMEOUT_MS));
      return;
    }
    void this.refresh(connection);
  }

  private async refresh(connection: Connection): Promise<void> {
    if (
      this.connection !== connection ||
      connection.consumers === 0 ||
      connection.pending
    ) {
      return;
    }

    connection.pending = true;
    const generation = ++connection.generation;
    const attemptedAtMs = Date.now();
    this.replaceState({ quota: this.state.quota, isRefreshing: true });

    try {
      const response = await connection.bridge.read();
      let snapshot;
      try {
        snapshot = parseCodexQuotaCommandResponse(response);
      } catch {
        this.recordFailure(
          connection,
          generation,
          "invalidResponse",
          attemptedAtMs,
          null,
        );
        return;
      }

      if (!this.isCurrent(connection, generation)) return;
      this.nextRefreshAtMs =
        Math.max(Date.now(), snapshot.observedAtMs) +
        CODEX_QUOTA_REFRESH_INTERVAL_MS;
      this.replaceState({
        quota: createCodexQuotaFreshState(snapshot),
        isRefreshing: false,
      });
    } catch (error: unknown) {
      const commandError = parseCodexQuotaCommandError(error);
      const reason = classifyCodexQuotaCommandError(commandError);
      if (!this.isCurrent(connection, generation)) return;

      if (reason === "refreshNotDue") {
        this.nextRefreshAtMs = this.nextAttemptAt(commandError.retryAfterMs);
        const quota =
          this.state.quota.snapshot || this.state.quota.lastAttemptAtMs !== null
            ? this.state.quota
            : applyCodexQuotaFailure(
                null,
                reason,
                attemptedAtMs,
              );
        this.replaceState({ quota, isRefreshing: false });
      } else if (reason === null) {
        this.nextRefreshAtMs = this.nextAttemptAt(
          commandError.code === "refreshInProgress"
            ? CODEX_QUOTA_BUSY_RETRY_MS
            : null,
        );
        this.replaceState({ quota: this.state.quota, isRefreshing: false });
      } else {
        this.recordFailure(
          connection,
          generation,
          reason,
          attemptedAtMs,
          commandError.retryAfterMs,
        );
      }
    } finally {
      connection.pending = false;
      if (this.connection !== connection) return;
      if (connection.consumers === 0) {
        this.connection = null;
        return;
      }
      if (this.state.isRefreshing) {
        this.replaceState({ quota: this.state.quota, isRefreshing: false });
      }
      this.refreshOrSchedule(connection);
    }
  }

  private recordFailure(
    connection: Connection,
    generation: number,
    reason: CodexQuotaFailureReason,
    attemptedAtMs: number,
    retryAfterMs: number | null,
  ): void {
    if (!this.isCurrent(connection, generation)) return;
    this.nextRefreshAtMs = this.nextAttemptAt(retryAfterMs);
    this.replaceState({
      quota: applyCodexQuotaFailure(this.state.quota, reason, attemptedAtMs),
      isRefreshing: false,
    });
  }

  private nextAttemptAt(retryAfterMs: number | null): number {
    const delay =
      retryAfterMs !== null && retryAfterMs > 0
        ? Math.min(retryAfterMs, 60 * 60_000)
        : CODEX_QUOTA_REFRESH_INTERVAL_MS;
    return Date.now() + delay;
  }

  private isCurrent(connection: Connection, generation: number): boolean {
    return (
      this.connection === connection &&
      connection.generation === generation &&
      connection.consumers > 0
    );
  }

  private replaceState(state: CodexQuotaStoreState): void {
    this.state = state;
    for (const subscriber of this.subscribers) subscriber();
  }
}
