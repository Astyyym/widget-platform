import { invoke } from "@tauri-apps/api/core";
import type { MediaBridge, MediaControlAction } from "./media-store";

export const mediaBridge: MediaBridge = {
  subscribe: () => invoke<unknown>("media_subscribe"),
  snapshot: () => invoke<unknown>("media_get_snapshot"),
  unsubscribe: () => invoke<void>("media_unsubscribe"),
  artwork: (reference) =>
    invoke<unknown>("media_get_artwork", { reference }),
  control: (
    sessionId: string,
    action: MediaControlAction,
    positionMs?: number,
  ) => invoke<boolean>("media_control", { sessionId, action, positionMs }),
};
