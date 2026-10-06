import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  TimerBridge,
  TimerChangedEvent,
  TimerSnapshot,
} from "./timer-store";

export const TIMER_CHANGED_EVENT = "timer://changed";

export const timerBridge: TimerBridge = {
  listen: (handler: (event: TimerChangedEvent) => void) =>
    listen<TimerSnapshot>(TIMER_CHANGED_EVENT, ({ payload }) =>
      handler({ snapshot: payload }),
    ),
  snapshot: () => invoke<TimerSnapshot>("timer_get_snapshot"),
  start: (actionId, phase, durationMs) =>
    invoke<TimerSnapshot>("timer_start", { actionId, phase, durationMs }),
  pause: (actionId) => invoke<TimerSnapshot>("timer_pause", { actionId }),
  resume: (actionId) => invoke<TimerSnapshot>("timer_resume", { actionId }),
  reset: (actionId, durationMs) =>
    invoke<TimerSnapshot>("timer_reset", { actionId, durationMs }),
  expire: (actionId, generation) =>
    invoke<TimerSnapshot>("timer_expire", { actionId, generation }),
};
