export type ClipboardEntry = {
  id: string;
  text: string;
  createdAtMs: number;
  sourceAppId: string | null;
  pinned: boolean;
  byteLen: number;
};

export type ClipboardSnapshot = {
  revision: number;
  enabled: boolean;
  listening: boolean;
  totalEntries: number;
  entries: ClipboardEntry[];
  error: string | null;
};

export type ClipboardState = {
  schemaVersion: 1;
  snapshot: ClipboardSnapshot | null;
  failure: string | null;
};

const MAX_PAGE_ENTRIES = 100;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_CHARS = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseEntry(value: unknown): ClipboardEntry {
  if (!isRecord(value)) throw new Error("剪贴板历史条目无效。");
  const text = typeof value.text === "string" ? value.text : "";
  const sourceAppId = value.sourceAppId === null || value.sourceAppId === undefined
    ? null
    : typeof value.sourceAppId === "string" && value.sourceAppId.length <= MAX_SOURCE_CHARS
      ? value.sourceAppId
      : null;
  if (
    typeof value.id !== "string" ||
    !/^clip-[1-9][0-9]*$/.test(value.id) ||
    text.length === 0 ||
    text.includes("\0") ||
    text.length > MAX_TEXT_BYTES ||
    !isSafeNonNegativeInteger(value.createdAtMs) ||
    typeof value.pinned !== "boolean" ||
    !isSafeNonNegativeInteger(value.byteLen) ||
    value.byteLen !== new TextEncoder().encode(text).length
  ) {
    throw new Error("剪贴板历史条目字段无效。");
  }
  return {
    id: value.id,
    text,
    createdAtMs: value.createdAtMs,
    sourceAppId,
    pinned: value.pinned,
    byteLen: value.byteLen,
  };
}

export function parseClipboardSnapshot(value: unknown): ClipboardSnapshot {
  if (!isRecord(value)) throw new Error("剪贴板快照无效。");
  if (
    !isSafeNonNegativeInteger(value.revision) ||
    typeof value.enabled !== "boolean" ||
    typeof value.listening !== "boolean" ||
    !isSafeNonNegativeInteger(value.totalEntries) ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_PAGE_ENTRIES ||
    value.entries.length > value.totalEntries
  ) {
    throw new Error("剪贴板快照状态或分页无效。");
  }
  if (value.enabled && !value.listening) {
    throw new Error("剪贴板监听状态无效。");
  }
  const entries = value.entries.map(parseEntry);
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) throw new Error("剪贴板历史条目标识重复。");
  if (value.error !== null && typeof value.error !== "string") {
    throw new Error("剪贴板运行时错误字段无效。");
  }
  return {
    revision: value.revision,
    enabled: value.enabled,
    listening: value.listening,
    totalEntries: value.totalEntries,
    entries,
    error: value.error,
  };
}

export const INITIAL_CLIPBOARD_STATE: ClipboardState = {
  schemaVersion: 1,
  snapshot: null,
  failure: null,
};

export function describeClipboardState(state: ClipboardState): string {
  if (state.failure) return "剪贴板历史暂不可用";
  if (!state.snapshot) return "剪贴板历史未连接";
  if (state.snapshot.error) return "剪贴板监听出现问题";
  if (!state.snapshot.enabled) return "剪贴板历史已关闭";
  return state.snapshot.listening ? "正在记录文本" : "正在停止监听";
}
