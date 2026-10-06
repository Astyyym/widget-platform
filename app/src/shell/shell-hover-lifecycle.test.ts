import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cursorPosition } from "@tauri-apps/api/window";
import { ShellFrame } from "./ShellFrame";
import type { ShellInteractionState } from "./shell-view";

const seam = vi.hoisted(() => ({
  interaction: null as ShellInteractionState | null,
}));

// E1 real ShellFrame handlers with controlled hook state/native promise timing.
// No DOM dependency, mounted native services, or live OS call. Real E2 is separate.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useRef: <T,>(initial: T) => ({ current: initial }),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
  useState: <T,>(initial: T | (() => T)) => {
    let value = typeof initial === "function" ? (initial as () => T)() : initial;
    const isInteraction = typeof value === "object" && value !== null && "hoveredModuleId" in value;
    if (isInteraction) seam.interaction = value as ShellInteractionState;
    return [value, (next: T | ((current: T) => T)) => {
      value = typeof next === "function" ? (next as (current: T) => T)(value) : next;
      if (isInteraction) seam.interaction = value as ShellInteractionState;
    }];
  },
}));
vi.mock("@tauri-apps/api/window", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tauri-apps/api/window")>(),
  cursorPosition: vi.fn(),
  getCurrentWindow: () => ({ outerPosition: async () => ({ x: 0, y: 0 }) }),
}));

type Pointer = { currentTarget: HTMLButtonElement; pointerId: number; button: number; isPrimary: boolean };
type Props = {
  children?: ReactNode;
  className?: string;
  "data-module-id"?: string;
  ref?: { current: unknown } | ((element: HTMLButtonElement) => void);
  onPointerEnter?: (event: Pointer) => void;
  onPointerLeave?: (event: Pointer) => void;
  onPointerDown?: (event: Pointer) => void;
  onPointerUp?: (event: Pointer) => void;
  onPointerCancel?: (event: Pointer) => void;
  onBlur?: () => void;
};
function nodes(node: ReactNode): Props[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Props>(node)) return [];
  return [node.props, ...nodes(node.props.children)];
}
function fakeButton(): HTMLButtonElement {
  return {
    getBoundingClientRect: () => ({ left: 10, top: 10, right: 60, bottom: 60, width: 50, height: 50 }),
  } as HTMLButtonElement;
}
function panel() {
  const tree = ShellFrame({ modules: [
    { id: "memory", label: "内存", symbol: "▥" },
    { id: "cpu", label: "CPU", symbol: "CPU" },
  ] });
  const all = nodes(tree);
  for (const props of all) {
    if (!props.ref) continue;
    const element = fakeButton();
    if (typeof props.ref === "function") props.ref(element);
    else props.ref.current = element;
  }
  const memory = all.find((props) => props["data-module-id"] === "memory")!;
  const cpu = all.find((props) => props["data-module-id"] === "cpu")!;
  const event = { currentTarget: fakeButton(), pointerId: 7, button: 0, isPrimary: true };
  return { memory, cpu, event, main: all[0] };
}
function deferredCursor() {
  let resolve!: (value: { x: number; y: number }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ x: number; y: number }>((done, fail) => { resolve = done; reject = fail; });
  vi.mocked(cursorPosition).mockReturnValue(promise as ReturnType<typeof cursorPosition>);
  return { resolve, reject };
}
async function flushPromises() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

describe("shell hover query lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    seam.interaction = null;
    vi.stubGlobal("window", { innerWidth: 440, innerHeight: 420, devicePixelRatio: 1, setTimeout, clearTimeout });
    vi.stubGlobal("document", { hidden: false, activeElement: null, elementFromPoint: vi.fn(() => null) });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("does not clear the pressed module when a previously started native query resolves", async () => {
    const query = deferredCursor();
    const { memory, event } = panel();
    memory.onPointerEnter!(event);
    memory.onPointerLeave!(event);
    vi.advanceTimersByTime(220);
    expect(cursorPosition).toHaveBeenCalledTimes(1);
    memory.onPointerDown!(event);
    query.resolve({ x: 500, y: 500 });
    await flushPromises();
    expect(seam.interaction?.hoveredModuleId).toBe("memory");
  });

  it("does not let a late outside result replace a newly hovered module", async () => {
    const query = deferredCursor();
    const { memory, cpu, event } = panel();
    memory.onPointerEnter!(event);
    memory.onPointerLeave!(event);
    vi.advanceTimersByTime(220);
    expect(cursorPosition).toHaveBeenCalledTimes(1);
    cpu.onPointerEnter!(event);
    query.resolve({ x: 500, y: 500 });
    await flushPromises();
    expect(seam.interaction?.hoveredModuleId).toBe("cpu");
  });

  it("does not let an obsolete native failure clear the new hover or report a current error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const query = deferredCursor();
    const { memory, cpu, event } = panel();
    memory.onPointerEnter!(event);
    memory.onPointerLeave!(event);
    vi.advanceTimersByTime(220);
    cpu.onPointerEnter!(event);
    query.reject(new Error("synthetic old query failure"));
    await flushPromises();
    expect(seam.interaction?.hoveredModuleId).toBe("cpu");
    expect(error).not.toHaveBeenCalled();
  });

  it("still clears hover for the current confirmed outside result", async () => {
    const query = deferredCursor();
    const { memory, event } = panel();
    memory.onPointerEnter!(event);
    memory.onPointerLeave!(event);
    vi.advanceTimersByTime(220);
    query.resolve({ x: 500, y: 500 });
    await flushPromises();
    expect(seam.interaction?.hoveredModuleId).toBeNull();
  });

  it("clears a pointer tooltip even when the module retains focus after closing a panel", async () => {
    const query = deferredCursor();
    const { memory, event } = panel();
    (document as unknown as { activeElement: unknown }).activeElement = event.currentTarget;
    memory.onPointerEnter!(event);
    memory.onPointerLeave!(event);
    vi.advanceTimersByTime(220);
    expect(cursorPosition).toHaveBeenCalledTimes(1);
    query.resolve({ x: 500, y: 500 });
    await flushPromises();
    expect(seam.interaction?.hoveredModuleId).toBeNull();
  });

  it("clears the old tooltip when the pointer is in blank dock space rather than on a module", async () => {
    const query = deferredCursor();
    const { memory, event } = panel();
    vi.mocked(document.elementFromPoint).mockReturnValue({ closest: (selector: string) => selector === ".shell-dock" ? {} : null } as Element);
    memory.onPointerEnter!(event);
    memory.onPointerLeave!(event);
    vi.advanceTimersByTime(220);
    query.resolve({ x: 100, y: 100 });
    await flushPromises();
    expect(seam.interaction?.hoveredModuleId).toBeNull();
  });

  it("still reports a current native failure rather than suppressing every error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const query = deferredCursor();
    const { memory, event } = panel();
    memory.onPointerEnter!(event);
    memory.onPointerLeave!(event);
    vi.advanceTimersByTime(220);
    query.reject(new Error("synthetic current query failure"));
    await flushPromises();
    expect(seam.interaction?.hoveredModuleId).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it.each(["onPointerUp", "onPointerCancel"] as const)("resumes hover cleanup after %s", async (release) => {
    const query = deferredCursor();
    const { memory, event } = panel();
    memory.onPointerEnter!(event);
    memory.onPointerDown!(event);
    memory.onPointerLeave!(event);
    vi.advanceTimersByTime(220);
    expect(cursorPosition).not.toHaveBeenCalled();
    memory[release]!(event);
    vi.advanceTimersByTime(220);
    expect(cursorPosition).toHaveBeenCalledTimes(1);
    query.resolve({ x: 500, y: 500 });
    await flushPromises();
    expect(seam.interaction?.hoveredModuleId).toBeNull();
  });

  it("keeps an obsolete result ignored after release while accepting the new query", async () => {
    const old = deferredCursor();
    const { memory, event } = panel();
    memory.onPointerEnter!(event);
    memory.onPointerLeave!(event);
    vi.advanceTimersByTime(220);
    const current = deferredCursor();
    memory.onPointerDown!(event);
    memory.onPointerUp!(event);
    vi.advanceTimersByTime(220);
    expect(cursorPosition).toHaveBeenCalledTimes(2);
    old.resolve({ x: 500, y: 500 });
    await flushPromises();
    expect(seam.interaction?.hoveredModuleId).toBe("memory");
    current.resolve({ x: 500, y: 500 });
    await flushPromises();
    expect(seam.interaction?.hoveredModuleId).toBeNull();
  });

  it.each(["onPointerUp", "onPointerCancel"] as const)("releases a module press when %s bubbles from elsewhere in the shell", async (release) => {
    const query = deferredCursor();
    const { memory, event, main } = panel();
    memory.onPointerEnter!(event);
    memory.onPointerDown!(event);
    main[release]!(event);
    memory.onPointerLeave!(event);
    vi.advanceTimersByTime(220);
    expect(cursorPosition).toHaveBeenCalledTimes(1);
    query.resolve({ x: 500, y: 500 });
    await flushPromises();
    expect(seam.interaction?.hoveredModuleId).toBeNull();
  });
});
