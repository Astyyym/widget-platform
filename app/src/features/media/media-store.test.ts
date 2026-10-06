import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEDIA_SNAPSHOT_INTERVAL_MS,
  MEDIA_MAX_ARTWORK_BYTES,
  MediaSnapshotStore,
  parseMediaArtwork,
  parseMediaSnapshot,
  type MediaBridge,
} from "./media-store";

const snapshot = {
  observedAtMs: 1_000,
  health: "available",
  error: null,
  currentSessionId: "media-session-1",
  sessions: [
    {
      sessionId: "media-session-1",
      sourceAppUserModelId: "MSEdge",
      title: "video",
      artist: null,
      albumTitle: null,
      artworkRef: "media-session-1/artwork/1",
      playbackState: "playing",
      timeline: { startMs: 0, endMs: 10_000, positionMs: 2_000 },
      capabilities: {
        canPlay: true,
        canPause: true,
        canPrevious: false,
        canNext: true,
        canSeek: true,
      },
      quality: "available",
    },
  ],
} as const;

function makeBridge(overrides: Partial<MediaBridge> = {}): MediaBridge {
  return {
    subscribe: vi.fn().mockResolvedValue(snapshot),
    snapshot: vi.fn().mockResolvedValue(snapshot),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    artwork: vi.fn().mockResolvedValue({ contentType: "image/png", bytes: [1, 2, 3] }),
    control: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

async function waitForState(store: MediaSnapshotStore): Promise<void> {
  await vi.waitFor(() => expect(store.getState().snapshot?.sessions).toHaveLength(1));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("media snapshot protocol", () => {
  it("parses session identity, capabilities, and timeline without inventing fields", () => {
    expect(parseMediaSnapshot(snapshot)).toMatchObject({
      currentSessionId: "media-session-1",
      sessions: [
        {
          sourceAppUserModelId: "MSEdge",
          title: "video",
          playbackState: "playing",
          capabilities: { canPause: true, canSeek: true },
          timeline: { positionMs: 2_000 },
        },
      ],
    });
  });

  it("rejects a current-session reference that is absent from the snapshot", () => {
    expect(() =>
      parseMediaSnapshot({ ...snapshot, currentSessionId: "unknown-session" }),
    ).toThrow("MEDIA_INVALID_SNAPSHOT");
  });

  it("bounds artwork payloads before converting bytes", () => {
    expect(parseMediaArtwork({ contentType: "image/png", bytes: [0, 255] }).bytes)
      .toEqual(new Uint8Array([0, 255]));
    expect(() => parseMediaArtwork({ contentType: "image/png", bytes: [] }))
      .toThrow("MEDIA_INVALID_ARTWORK");
    expect(() =>
      parseMediaArtwork({
        contentType: "image/png",
        bytes: new Array(MEDIA_MAX_ARTWORK_BYTES + 1).fill(0),
      }),
    ).toThrow("MEDIA_INVALID_ARTWORK");
  });
});

describe("media snapshot store lifecycle", () => {
  it("opens on the first consumer, polls, then stops on the last consumer", async () => {
    vi.useFakeTimers();
    const bridge = makeBridge();
    const store = new MediaSnapshotStore();
    const disconnect = store.connect(bridge);

    await vi.waitFor(() => expect(bridge.subscribe).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(store.getState().snapshot?.sessions).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(MEDIA_SNAPSHOT_INTERVAL_MS);
    expect(bridge.snapshot).toHaveBeenCalledTimes(1);

    disconnect();
    await vi.waitFor(() => expect(bridge.unsubscribe).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(MEDIA_SNAPSHOT_INTERVAL_MS * 2);
    expect(bridge.snapshot).toHaveBeenCalledTimes(1);
  });

  it("shares one native subscription across consumers", async () => {
    const bridge = makeBridge();
    const store = new MediaSnapshotStore();
    const disconnectFirst = store.connect(bridge);
    const disconnectSecond = store.connect(bridge);

    await waitForState(store);
    disconnectFirst();
    expect(bridge.unsubscribe).not.toHaveBeenCalled();
    disconnectSecond();
    await vi.waitFor(() => expect(bridge.unsubscribe).toHaveBeenCalledTimes(1));
  });

  it("does not fabricate a session when the native subscription fails", async () => {
    const bridge = makeBridge({
      subscribe: vi.fn().mockRejectedValue(new Error("native detail is not exposed")),
    });
    const store = new MediaSnapshotStore();
    const disconnect = store.connect(bridge);

    await vi.waitFor(() => expect(store.getState().error).toBeTruthy());
    expect(store.getState().snapshot).toBeNull();
    disconnect();
  });
});
