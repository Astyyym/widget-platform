import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
import { DEFAULT_WIDGET_SETTINGS } from "./settings-model";
import { calculateShellLayout } from "../shell/shell-layout";

type Draft = {
  name: string;
  latitude: string;
  longitude: string;
  timezone: string;
  temperatureUnit: string;
};
const deferred = vi.hoisted(() => ({
  hookIndex: 0,
  updates: [] as Array<(current: Draft) => Draft>,
}));

// No DOM test dependency is installed. Defer the real component's state updater
// until after React's event currentTarget lifetime, the observed crash boundary.
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    useRef: <T,>(value: T) => ({ current: value }),
    useEffect: vi.fn(),
    useState: <T,>(initial: T | (() => T)) => {
      const hook = deferred.hookIndex++;
      const value = hook === 0
        ? "services"
        : typeof initial === "function" ? (initial as () => T)() : initial;
      return [value, (next: unknown) => {
        if (hook === 1 && typeof next === "function") {
          deferred.updates.push(next as (current: Draft) => Draft);
        }
      }];
    },
  };
});

type Event = { currentTarget: { value: string } | null };
type Props = { children?: ReactNode; type?: string; onChange?: (event: Event) => void };
function textInputs(node: ReactNode): Props[] {
  if (Array.isArray(node)) return node.flatMap(textInputs);
  if (!isValidElement<Props>(node)) return [];
  return [
    ...(node.type === "input" && node.props.type === "text" ? [node.props] : []),
    ...textInputs(node.props.children),
  ];
}

describe("weather settings draft event lifetime", () => {
  beforeEach(() => {
    deferred.hookIndex = 0;
    deferred.updates = [];
  });

  it.each([
    [0, "name", "C3 测试城市"],
  ] as const)("captures %s/%s before currentTarget is released", (index, field, value) => {
    const onChange = vi.fn(async () => true);
    const panel = SettingsPanel({
      settings: DEFAULT_WIDGET_SETTINGS,
      layout: calculateShellLayout({ stageWidth: 440, stageHeight: 520, edge: "top", itemCount: 5, iconSize: 46, ringMode: "off" }),
      notice: null,
      saveState: "idle",
      saveFailure: null,
      closeButtonRef: { current: null },
      onChange,
      onClose: vi.fn(),
    });
    const inputs = textInputs(panel);
    expect(inputs).toHaveLength(1); // City only: coordinates/timezone are internal.
    const event: Event = { currentTarget: { value } };
    inputs[index].onChange!(event);
    event.currentTarget = null;
    const original: Draft = { name: "原名", latitude: "1", longitude: "2", timezone: "UTC", temperatureUnit: "fahrenheit" };
    expect(deferred.updates).toHaveLength(1);
    const next = deferred.updates[0]!(original);
    expect(next).toEqual({ ...original, [field]: value });
    expect(original.name).toBe("原名");
    expect(onChange).not.toHaveBeenCalled(); // Draft input must not save/request.
  });
});
