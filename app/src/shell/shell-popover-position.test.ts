import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShellFrame } from "./ShellFrame";

// E1 persistent hooks + controlled DOM rectangles, not a mounted/native claim.
const seam = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, layouts: [] as (() => void)[], height: 124,
  native: false, effects: [] as { effect: () => void | (() => void); deps?: unknown[] }[],
  effectStates: new Map<number, { deps?: unknown[]; cleanup?: () => void }>(),
  updates: [] as { mode: string; resolve: () => void }[],
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: <T,>(initial: T) => { const key = seam.cursor++; return (seam.slots[key] ??= { current: initial }); },
  useState: <T,>(initial: T | (() => T)) => {
    const key = seam.cursor++;
    if (!(key in seam.slots)) seam.slots[key] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [seam.slots[key], (next: T | ((value: T) => T)) => {
      seam.slots[key] = typeof next === "function" ? (next as (value: T) => T)(seam.slots[key] as T) : next;
    }];
  },
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => { seam.effects.push({ effect, deps }); },
  useLayoutEffect: (effect: () => void) => { seam.layouts.push(effect); },
}));
vi.mock("./native-widget-window", async (original) => ({
  ...await original<typeof import("./native-widget-window")>(),
  createWidgetWindowController: async () => ({
    update: (_edge: unknown, _offset: unknown, mode: string) => new Promise<void>(resolve => { seam.updates.push({ mode, resolve }); }),
    dispose: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/api/window", async (original) => ({
  ...await original<typeof import("@tauri-apps/api/window")>(),
  cursorPosition: async () => ({ x: 900, y: 900 }),
  getCurrentWindow: () => ({ outerPosition: async () => ({ x: 0, y: 0 }) }),
}));
type Props = {
  children?: ReactNode; className?: string; "data-module-id"?: string;
  style?: { left?: string; top?: string; visibility?: string };
  "aria-hidden"?: boolean;
  ref?: { current: unknown } | ((value: HTMLButtonElement) => void);
  onPointerEnter?: (event: { currentTarget: HTMLButtonElement }) => void;
  onPointerLeave?: () => void;
  onClick?: () => void;
  onFocus?: (event: { currentTarget: HTMLButtonElement }) => void;
};
function nodes(value: ReactNode): Props[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<Props>(value)) return [];
  return [value.props, ...nodes(value.props.children)];
}
const box = (left: number, top: number, width: number, height: number) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});
function render() {
  seam.cursor = 0; seam.layouts = []; seam.effects = [];
  const all = nodes(ShellFrame({ isFixture: !seam.native, longSide: 580, modules: [
    { id: "cpu", label: "CPU", symbol: "CPU" },
    { id: "memory", label: "内存", symbol: "▥" },
  ] }));
  for (const props of all) {
    if (!props.ref) continue;
    const rect = () => props.className?.startsWith("shell-stage") ? box(0, 0, 640, seam.height)
      : props.className === "shell-dock" ? box(30, 0, 580, 80)
      : props.className === "shell-popover" ? box(0, 0, 286, 99)
      : box(props["data-module-id"] === "memory" ? 340 : 280, 15, 50, 50);
    const element = { getBoundingClientRect: rect, focus: () => props.onFocus?.({ currentTarget: element }) } as HTMLButtonElement;
    if (typeof props.ref === "function") props.ref(element); else props.ref.current = element;
  }
  for (const effect of seam.layouts) effect();
  if (seam.native) seam.effects.forEach(({ effect, deps }, index) => {
    // E1: run native geometry effects only, not OS services or subscriptions.
    if (!effect.toString().includes("Could not initialize the desktop widget window") &&
        !effect.toString().includes("Could not update desktop widget window geometry")) return;
    const previous = seam.effectStates.get(index);
    if (previous && deps?.every((value, i) => Object.is(value, previous.deps?.[i]))) return;
    previous?.cleanup?.();
    const cleanup = effect();
    seam.effectStates.set(index, { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined });
  });
  return all;
}
function tooltip() { return render().find(p => p.className === "shell-popover"); }

beforeEach(() => {
  vi.useFakeTimers();
  seam.slots = []; seam.height = 124; seam.native = false; seam.updates = []; seam.effectStates.clear();
  vi.stubGlobal("window", { innerWidth: 640, innerHeight: 124, screen: { availWidth: 1920, availHeight: 1040 }, setTimeout, clearTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { hidden: false, elementFromPoint: () => null });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 1; });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("first pointer preview geometry", () => {
  it("restores module keyboard focus after closing a panel without manufacturing a new pointer preview", () => {
    seam.height = 240;
    const focusEffect = () => seam.effects.find(x => x.effect.toString().includes("previousPanelId.current"))!.effect();
    render().find(p => p["data-module-id"] === "cpu")!.onClick!();
    render(); focusEffect();
    render().find(p => p.className === "shell-panel-close")!.onClick!();
    render(); focusEffect();
    expect(tooltip()).toBeUndefined();
    // Ordinary Tab/focus is still a supported preview entry.
    render().find(p => p["data-module-id"] === "cpu")!.onFocus!({
      currentTarget: { getBoundingClientRect: () => box(280, 15, 50, 50) } as HTMLButtonElement,
    });
    expect(tooltip()).toBeDefined();
  });
  it("keeps the first preview hidden until space exists then repositions without another enter", () => {
    const cpu = render().find(p => p["data-module-id"] === "cpu")!;
    cpu.onPointerEnter!({ currentTarget: { getBoundingClientRect: () => box(280, 15, 50, 50) } as HTMLButtonElement });
    expect(tooltip()?.style?.visibility).toBe("hidden");
    seam.height = 240;
    render(); render();
    const preview = tooltip()!;
    expect(preview.style?.visibility).toBe("visible");
    expect(Number.parseFloat(preview.style!.top!)).toBe(92);
  });
  it("does not reuse a previous hover's ready receipt while a new resize is pending", async () => {
    seam.native = true;
    const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    const enter = () => render().find(p => p["data-module-id"] === "cpu")!.onPointerEnter!({
      currentTarget: { getBoundingClientRect: () => box(280, 15, 50, 50) } as HTMLButtonElement,
    });
    render(); await flush();
    seam.updates.at(-1)!.resolve(); await flush(); render();
    enter(); render(); render();
    seam.height = 240;
    seam.updates.at(-1)!.resolve(); await flush(); render(); render();
    expect(tooltip()?.style?.visibility).toBe("visible");
    render().find(p => p["data-module-id"] === "cpu")!.onPointerLeave!();
    vi.advanceTimersByTime(220); await flush(); render();
    const oldCompact = seam.updates.at(-1)!;
    expect(oldCompact.mode).toBe("compact");
    enter(); render(); render();
    const latest = seam.updates.at(-1)!;
    expect(latest.mode).toBe("popover");
    expect(tooltip()?.style?.visibility).toBe("hidden");
    oldCompact.resolve(); await flush(); render();
    expect(tooltip()?.style?.visibility).toBe("hidden");
    latest.resolve(); await flush(); render(); render();
    expect(tooltip()?.style?.visibility).toBe("visible");
    expect(tooltip()?.style?.top).toBe("92px");
  });
});
