import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  type CounterBridge,
  type CounterChangedEvent,
  type CounterSnapshot,
} from "./counter-store";

export const COUNTER_CHANGED_EVENT = "counter-probe://changed";

export const counterBridge = {
  listen: (handler: (event: CounterChangedEvent) => void) =>
    listen<CounterSnapshot>(COUNTER_CHANGED_EVENT, ({ payload }) => handler({ snapshot: payload })),
  snapshot: () => invoke<CounterSnapshot>("counter_probe_snapshot"),
  enable: () => invoke<CounterSnapshot>("counter_probe_enable"),
  disable: () => invoke<CounterSnapshot>("counter_probe_disable"),
} satisfies CounterBridge & {
  enable: () => Promise<CounterSnapshot>;
  disable: () => Promise<CounterSnapshot>;
};
