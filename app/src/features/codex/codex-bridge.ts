import { invoke } from "@tauri-apps/api/core";

export interface CodexQuotaBridge {
  read(): Promise<unknown>;
  cancel(): Promise<boolean>;
}

export const codexQuotaBridge: CodexQuotaBridge = {
  read: () => invoke<unknown>("codex_quota_read"),
  cancel: () => invoke<boolean>("codex_quota_cancel"),
};
