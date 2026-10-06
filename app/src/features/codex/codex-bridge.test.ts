import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { codexQuotaBridge } from "./codex-bridge";

describe("Codex quota Tauri bridge", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("calls the read command without forwarding arguments", async () => {
    const response = { observedAtMs: 123 };
    vi.mocked(invoke).mockResolvedValue(response);

    await expect(codexQuotaBridge.read()).resolves.toBe(response);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("codex_quota_read");
  });

  it("cancels only through the registered command", async () => {
    vi.mocked(invoke).mockResolvedValue(true);

    await expect(codexQuotaBridge.cancel()).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("codex_quota_cancel");
  });
});
