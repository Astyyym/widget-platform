export const MEDIA_SNAPSHOT_INTERVAL_MS = 1_000;
export const MEDIA_MAX_ARTWORK_BYTES = 3 * 1024 * 1024;

export type MediaHealth = "connecting" | "available" | "partial" | "unavailable";
export type MediaPlaybackState =
  | "closed"
  | "opened"
  | "changing"
  | "stopped"
  | "playing"
  | "paused";

export type MediaControlAction = "play" | "pause" | "previous" | "next" | "seek";

export type MediaSession = {
  sessionId: string;
  sourceAppUserModelId: string | null;
  title: string | null;
  artist: string | null;
  albumTitle: string | null;
  artworkRef: string | null;
  playbackState: MediaPlaybackState | null;
  timeline: {
    startMs: number | null;
    endMs: number | null;
    positionMs: number | null;
  };
  capabilities: {
    canPlay: boolean | null;
    canPause: boolean | null;
    canPrevious: boolean | null;
    canNext: boolean | null;
    canSeek: boolean | null;
  };
  quality: MediaHealth;
};

export type MediaSnapshot = {
  observedAtMs: number;
  health: MediaHealth;
  error: "accessDenied" | "operationTimedOut" | "providerUnavailable" | null;
  currentSessionId: string | null;
  sessions: MediaSession[];
};

export type MediaArtwork = {
  contentType: string;
  bytes: Uint8Array;
};

export type MediaViewState = {
  snapshot: MediaSnapshot | null;
  error: string | null;
};

export interface MediaBridge {
  subscribe(): Promise<unknown>;
  snapshot(): Promise<unknown>;
  unsubscribe(): Promise<void>;
  artwork(reference: string): Promise<unknown>;
  control(
    sessionId: string,
    action: MediaControlAction,
    positionMs?: number,
  ): Promise<boolean>;
}

type Connection = {
  bridge: MediaBridge;
  consumers: number;
  subscribed: boolean;
  pending: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

export type Unsubscribe = () => void;

function invalidSnapshot(): Error {
  return new Error("MEDIA_INVALID_SNAPSHOT");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function optionalString(value: unknown, maximumLength = 1_024): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maximumLength) {
    throw invalidSnapshot();
  }
  return value;
}

function optionalInteger(value: unknown): number | null {
  if (value === null) return null;
  if (!isSafeNonNegativeInteger(value)) throw invalidSnapshot();
  return value;
}

function isHealth(value: unknown): value is MediaHealth {
  return ["connecting", "available", "partial", "unavailable"].includes(
    value as string,
  );
}

export function parseMediaSnapshot(value: unknown): MediaSnapshot {
  if (!isRecord(value) || !Array.isArray(value.sessions)) {
    throw invalidSnapshot();
  }
  if (
    !isSafeNonNegativeInteger(value.observedAtMs) ||
    !isHealth(value.health) ||
    (value.error !== null &&
      !["accessDenied", "operationTimedOut", "providerUnavailable"].includes(
        value.error as string,
      ))
  ) {
    throw invalidSnapshot();
  }

  const currentSessionId = optionalString(value.currentSessionId, 128);
  const sessions = value.sessions.map((item): MediaSession => {
    if (!isRecord(item) || !isRecord(item.timeline) || !isRecord(item.capabilities)) {
      throw invalidSnapshot();
    }
    if (
      typeof item.sessionId !== "string" ||
      item.sessionId.length === 0 ||
      item.sessionId.length > 128 ||
      !isHealth(item.quality) ||
      (item.playbackState !== null &&
        ![
          "closed",
          "opened",
          "changing",
          "stopped",
          "playing",
          "paused",
        ].includes(item.playbackState as string))
    ) {
      throw invalidSnapshot();
    }

    const capabilities = item.capabilities;
    for (const key of ["canPlay", "canPause", "canPrevious", "canNext", "canSeek"]) {
      if (capabilities[key] !== null && typeof capabilities[key] !== "boolean") {
        throw invalidSnapshot();
      }
    }

    return {
      sessionId: item.sessionId,
      sourceAppUserModelId: optionalString(item.sourceAppUserModelId),
      title: optionalString(item.title),
      artist: optionalString(item.artist),
      albumTitle: optionalString(item.albumTitle),
      artworkRef: optionalString(item.artworkRef, 160),
      playbackState: item.playbackState as MediaPlaybackState | null,
      timeline: {
        startMs: optionalInteger(item.timeline.startMs),
        endMs: optionalInteger(item.timeline.endMs),
        positionMs: optionalInteger(item.timeline.positionMs),
      },
      capabilities: {
        canPlay: capabilities.canPlay as boolean | null,
        canPause: capabilities.canPause as boolean | null,
        canPrevious: capabilities.canPrevious as boolean | null,
        canNext: capabilities.canNext as boolean | null,
        canSeek: capabilities.canSeek as boolean | null,
      },
      quality: item.quality,
    };
  });

  if (
    currentSessionId !== null &&
    !sessions.some((session) => session.sessionId === currentSessionId)
  ) {
    throw invalidSnapshot();
  }

  return {
    observedAtMs: value.observedAtMs,
    health: value.health,
    error: value.error as MediaSnapshot["error"],
    currentSessionId,
    sessions,
  };
}

export function parseMediaArtwork(value: unknown): MediaArtwork {
  if (!isRecord(value) || typeof value.contentType !== "string") {
    throw new Error("MEDIA_INVALID_ARTWORK");
  }
  if (
    !Array.isArray(value.bytes) ||
    value.bytes.length === 0 ||
    value.bytes.length > MEDIA_MAX_ARTWORK_BYTES ||
    !value.bytes.every(
      (byte) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255,
    )
  ) {
    throw new Error("MEDIA_INVALID_ARTWORK");
  }
  return {
    contentType: value.contentType,
    bytes: Uint8Array.from(value.bytes as number[]),
  };
}

export class MediaSnapshotStore {
  private state: MediaViewState = { snapshot: null, error: null };
  private readonly subscribers = new Set<() => void>();
  private connection: Connection | null = null;

  readonly getState = (): MediaViewState => this.state;

  readonly subscribeToState = (subscriber: () => void): Unsubscribe => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  connect(bridge: MediaBridge): Unsubscribe {
    let connection = this.connection;
    if (!connection) {
      connection = {
        bridge,
        consumers: 0,
        subscribed: false,
        pending: false,
        timer: null,
      };
      this.connection = connection;
      this.replaceState({ snapshot: null, error: null });
    }

    connection.consumers += 1;
    if (connection.consumers === 1) void this.refresh(connection);

    let disconnected = false;
    return () => {
      if (disconnected) return;
      disconnected = true;
      if (this.connection !== connection) return;
      connection!.consumers = Math.max(0, connection!.consumers - 1);
      if (connection!.consumers === 0) this.stop(connection!);
    };
  }

  async readArtwork(
    bridge: MediaBridge,
    reference: string,
  ): Promise<MediaArtwork> {
    return parseMediaArtwork(await bridge.artwork(reference));
  }

  private async refresh(connection: Connection): Promise<void> {
    if (this.connection !== connection || connection.pending) return;
    connection.pending = true;
    try {
      const raw = connection.subscribed
        ? await connection.bridge.snapshot()
        : await connection.bridge.subscribe();
      if (!connection.subscribed) {
        connection.subscribed = true;
        if (this.connection !== connection || connection.consumers === 0) {
          connection.subscribed = false;
          await connection.bridge.unsubscribe().catch(() => undefined);
          return;
        }
      }
      const snapshot = parseMediaSnapshot(raw);
      if (this.connection === connection) this.replaceState({ snapshot, error: null });
    } catch {
      if (this.connection === connection) {
        this.replaceState({
          snapshot: this.state.snapshot,
          error: "媒体读取失败；保留上次成功状态。",
        });
      }
    } finally {
      connection.pending = false;
      if (this.connection === connection && connection.consumers > 0) {
        connection.timer = setTimeout(() => {
          connection.timer = null;
          void this.refresh(connection);
        }, MEDIA_SNAPSHOT_INTERVAL_MS);
      }
    }
  }

  private stop(connection: Connection): void {
    if (connection.timer !== null) clearTimeout(connection.timer);
    connection.timer = null;
    if (this.connection === connection) this.connection = null;
    this.replaceState({ snapshot: null, error: null });
    if (connection.subscribed) {
      connection.subscribed = false;
      void connection.bridge.unsubscribe().catch(() => undefined);
    }
  }

  private replaceState(state: MediaViewState): void {
    this.state = state;
    for (const subscriber of this.subscribers) subscriber();
  }
}
