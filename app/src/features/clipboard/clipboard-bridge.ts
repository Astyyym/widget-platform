import { invoke } from "@tauri-apps/api/core";
import type { ClipboardBridge } from "./clipboard-store";

export const clipboardBridge: ClipboardBridge = {
  snapshot: (offset = 0, limit = 100) =>
    invoke("clipboard_get_snapshot", { offset, limit }),
  setEnabled: (enabled) => invoke("clipboard_set_enabled", { enabled }),
  copy: (entryId, actionId) =>
    invoke("clipboard_restore", { entryId, actionId }),
  deleteEntry: (entryId) => invoke("clipboard_delete", { entryId }),
  clearAll: () => invoke("clipboard_clear", { scope: "all" }),
};
