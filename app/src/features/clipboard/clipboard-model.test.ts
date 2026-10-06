import { describe, expect, it } from "vitest";
import {
  INITIAL_CLIPBOARD_STATE,
  parseClipboardSnapshot,
  type ClipboardSnapshot,
} from "./clipboard-model";

function rawSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    revision: 2,
    enabled: false,
    listening: false,
    totalEntries: 1,
    entries: [
      {
        id: "clip-1",
        text: "第一条文本",
        createdAtMs: 1_700_000_000_000,
        sourceAppId: "Editor.exe",
        pinned: false,
        byteLen: 15,
      },
    ],
    error: null,
    ...overrides,
  };
}

describe("clipboard model", () => {
  it("starts disabled and without history", () => {
    expect(INITIAL_CLIPBOARD_STATE).toEqual({
      schemaVersion: 1,
      snapshot: null,
      failure: null,
    });
  });

  it("parses a bounded snapshot and preserves explicit runtime state", () => {
    const snapshot = parseClipboardSnapshot(rawSnapshot());
    expect(snapshot).toMatchObject<Partial<ClipboardSnapshot>>({
      revision: 2,
      enabled: false,
      listening: false,
      totalEntries: 1,
    });
    expect(snapshot.entries[0]).toMatchObject({
      id: "clip-1",
      text: "第一条文本",
      sourceAppId: "Editor.exe",
    });
  });

  it("rejects malformed, oversized, or over-paged history", () => {
    expect(() => parseClipboardSnapshot({ ...rawSnapshot(), revision: -1 })).toThrow();
    expect(() => parseClipboardSnapshot({ ...rawSnapshot(), entries: new Array(101).fill(rawSnapshot().entries[0]) })).toThrow();
    expect(() => parseClipboardSnapshot({
      ...rawSnapshot(),
      entries: [{ ...rawSnapshot().entries[0], text: "x".repeat(10 * 1024 * 1024 + 1) }],
    })).toThrow();
  });

  it("rejects an enabled snapshot that is not actually listening", () => {
    expect(() => parseClipboardSnapshot(rawSnapshot({ enabled: true, listening: false }))).toThrow(
      "监听状态",
    );
  });
});
