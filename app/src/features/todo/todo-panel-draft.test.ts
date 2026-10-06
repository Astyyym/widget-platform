import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TodoPanel } from "./TodoPanel";
import { todoBridge } from "./todo-bridge";
import { TodoSnapshotStore } from "./todo-store";

// E1 component-handler seam; actual mount/unmount is verified in real Release.
// No new DOM dependency and no native calls.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: <T,>(initial: T | (() => T)) => [
    typeof initial === "function" ? (initial as () => T)() : initial,
    vi.fn(),
  ],
  useRef: <T,>(initial: T) => ({ current: initial }),
  useEffect: vi.fn(),
}));
vi.mock("./todo-bridge", () => ({ todoBridge: { add: vi.fn() } }));

type Props = {
  children?: ReactNode;
  value?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onSubmit?: (event: { preventDefault: () => void }) => void;
};
function element(node: ReactNode, type: string): Props {
  if (Array.isArray(node)) {
    for (const child of node) {
      try { return element(child, type); } catch { /* Search remaining siblings. */ }
    }
  } else if (isValidElement<Props>(node)) {
    if (node.type === type) return node.props;
    return element(node.props.children, type);
  }
  throw new Error(`Missing ${type}`);
}
type DraftChange = (next: string | ((current: string) => string)) => void;
function panel(draft: string, onDraftChange: DraftChange) {
  const props = {
    closeButtonRef: { current: null }, onClose: vi.fn(),
    snapshotError: null, snapshotSyncStatus: "ready" as const,
    store: new TodoSnapshotStore(), draft, onDraftChange,
  };
  return TodoPanel(props);
}

describe("Todo draft owned by its lasting parent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the parent's draft after panel remount", () => {
    expect(element(panel("未保存草稿", vi.fn()), "input").value).toBe("未保存草稿");
  });

  it("sends edits to the parent and reuses them in a fresh panel", () => {
    let draft = "";
    const change: DraftChange = (next) => { draft = typeof next === "function" ? next(draft) : next; };
    element(panel(draft, change), "input").onChange!({ target: { value: "新草稿" } });
    expect(draft).toBe("新草稿");
    expect(element(panel(draft, change), "input").value).toBe("新草稿");
  });

  it("clears the parent draft only after successful persistence", async () => {
    vi.mocked(todoBridge.add).mockResolvedValue({ schemaVersion: 1, revision: 1, instanceId: "draft-test", items: [] });
    let draft = " 合成任务 ";
    const change = vi.fn<DraftChange>((next) => { draft = typeof next === "function" ? next(draft) : next; });
    element(panel(draft, change), "form").onSubmit!({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(todoBridge.add).toHaveBeenCalled());
    expect(todoBridge.add).toHaveBeenCalledWith(expect.any(String), "合成任务");
    await vi.waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    expect(draft).toBe("");
  });

  it("does not erase the parent draft when persistence fails", async () => {
    vi.mocked(todoBridge.add).mockRejectedValue({ code: "writeFailed", message: "synthetic refusal", retryable: true });
    const change = vi.fn();
    element(panel("保留失败草稿", change), "form").onSubmit!({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(todoBridge.add).toHaveBeenCalled());
    expect(change).not.toHaveBeenCalled();
  });

  it("does not erase edits made while an earlier submission is pending", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(todoBridge.add).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let draft = "提交中的旧草稿";
    const change = vi.fn<DraftChange>((next) => { draft = typeof next === "function" ? next(draft) : next; });
    element(panel(draft, change), "form").onSubmit!({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(todoBridge.add).toHaveBeenCalled());
    draft = "期间输入的新草稿";
    finish({ schemaVersion: 1, revision: 1, instanceId: "pending-draft", items: [] });
    await vi.waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    expect(draft).toBe("期间输入的新草稿");
  });
});
