import {
  INITIAL_CLIPBOARD_STATE,
  parseClipboardSnapshot,
  type ClipboardSnapshot,
  type ClipboardState,
} from "./clipboard-model";
import type { ClipboardEntry } from "./clipboard-model";

export type ClipboardBridge = {
  snapshot: (offset?: number, limit?: number) => Promise<unknown>;
  setEnabled: (enabled: boolean) => Promise<unknown>;
  copy: (entryId: string, actionId: string) => Promise<unknown>;
  deleteEntry: (entryId: string) => Promise<unknown>;
  clearAll: () => Promise<unknown>;
};

type Subscriber = () => void;

function safeError(): string {
  return "剪贴板历史暂不可用";
}

export class ClipboardSnapshotStore {
  private state: ClipboardState = INITIAL_CLIPBOARD_STATE;
  private generation = 0;
  private readonly subscribers = new Set<Subscriber>();

  constructor(private readonly bridge: ClipboardBridge) {}

  getState = (): ClipboardState => this.state;

  subscribe = (subscriber: Subscriber): (() => void) => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  async refresh(): Promise<void> {
    await this.refreshPage(0, 100);
  }

  async refreshPage(offset: number, limit = 100): Promise<void> {
    const generation = ++this.generation;
    try {
      const snapshot = parseClipboardSnapshot(await this.bridge.snapshot(offset, limit));
      if (generation !== this.generation) return;
      this.replace({ schemaVersion: 1, snapshot, failure: null });
    } catch {
      if (generation !== this.generation) return;
      this.replace({ schemaVersion: 1, snapshot: null, failure: safeError() });
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    try {
      await this.bridge.setEnabled(enabled);
      await this.refresh();
    } catch {
      this.replace({ ...this.state, failure: safeError() });
    }
  }

  async copy(entryId: string, actionId: string): Promise<void> {
    await this.mutate(() => this.bridge.copy(entryId, actionId));
  }

  async deleteEntry(entryId: string): Promise<void> {
    await this.mutate(() => this.bridge.deleteEntry(entryId));
  }

  async clearAll(): Promise<void> {
    await this.mutate(() => this.bridge.clearAll());
  }

  entries(): ClipboardEntry[] {
    return this.state.snapshot?.entries ?? [];
  }

  private async mutate(operation: () => Promise<unknown>): Promise<void> {
    try {
      await operation();
      await this.refresh();
    } catch {
      this.replace({ ...this.state, failure: safeError() });
    }
  }

  private replace(state: ClipboardState): void {
    this.state = state;
    for (const subscriber of this.subscribers) subscriber();
  }
}

export function clipboardRevision(snapshot: ClipboardSnapshot | null): number {
  return snapshot?.revision ?? 0;
}
