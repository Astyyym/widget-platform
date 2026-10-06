import {
  parseMetricsSnapshot,
  type MetricsViewState,
} from "./metrics-model";
import type { MetricsBridge } from "./metrics-bridge";

export const METRICS_SAMPLE_INTERVAL_MS = 2_000;
export type Unsubscribe = () => void;

type SamplingConnection = {
  bridge: MetricsBridge;
  sessionId: string;
  consumers: number;
  timer: ReturnType<typeof setTimeout> | null;
  pending: boolean;
};

function createSessionId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `metrics-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

export class MetricsSnapshotStore {
  private state: MetricsViewState = { snapshot: null, error: null };
  private readonly subscribers = new Set<() => void>();
  private connection: SamplingConnection | null = null;

  constructor(
    private readonly intervalMs = METRICS_SAMPLE_INTERVAL_MS,
    private readonly makeSessionId: () => string = createSessionId,
  ) {}

  readonly getState = (): MetricsViewState => this.state;

  readonly subscribe = (subscriber: () => void): Unsubscribe => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  connect(bridge: MetricsBridge): Unsubscribe {
    let connection = this.connection;
    if (!connection) {
      connection = {
        bridge,
        sessionId: this.makeSessionId(),
        consumers: 0,
        timer: null,
        pending: false,
      };
      this.connection = connection;
      this.replaceState({ snapshot: null, error: null });
    }

    connection.consumers += 1;
    if (connection.consumers === 1) void this.sample(connection);

    let disconnected = false;
    return () => {
      if (disconnected) return;
      disconnected = true;
      if (this.connection !== connection) return;
      connection!.consumers = Math.max(0, connection!.consumers - 1);
      if (connection!.consumers === 0) this.stop(connection!);
    };
  }

  private async sample(connection: SamplingConnection): Promise<void> {
    if (this.connection !== connection || connection.pending) return;
    connection.pending = true;
    try {
      const snapshot = parseMetricsSnapshot(
        await connection.bridge.sample(connection.sessionId),
      );
      if (this.connection === connection) {
        this.replaceState({ snapshot, error: null });
      }
    } catch {
      if (this.connection === connection) {
        this.replaceState({
          snapshot: this.state.snapshot,
          error: "指标读取失败；保留上次成功读数。",
        });
      }
    } finally {
      connection.pending = false;
      if (this.connection === connection && connection.consumers > 0) {
        connection.timer = setTimeout(() => {
          connection.timer = null;
          void this.sample(connection);
        }, this.intervalMs);
      }
    }
  }

  private stop(connection: SamplingConnection): void {
    if (connection.timer !== null) clearTimeout(connection.timer);
    connection.timer = null;
    if (this.connection === connection) this.connection = null;
    this.replaceState({ snapshot: null, error: null });
  }

  private replaceState(state: MetricsViewState): void {
    this.state = state;
    for (const subscriber of this.subscribers) subscriber();
  }
}
