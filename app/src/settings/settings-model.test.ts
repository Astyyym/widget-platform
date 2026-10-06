import { describe, expect, it } from "vitest";
import {
  CONTENT_REGISTRY,
  DEFAULT_WIDGET_SETTINGS,
  parseWidgetSettings,
} from "./settings-model";

describe("widget settings", () => {
  it("defaults old appearance settings and validates material, opacity, and blur", () => {
    const old = { ...DEFAULT_WIDGET_SETTINGS } as Record<string, unknown>;
    delete old.dockOpacity;
    delete old.dockMaterial;
    delete old.dockBlur;
    expect(parseWidgetSettings(old)).toMatchObject({ dockOpacity: 100, dockMaterial: "solid", dockBlur: 16 });
    expect(parseWidgetSettings({ ...old, dockOpacity: 0, dockMaterial: "glass", dockBlur: 32 })).toMatchObject({ dockOpacity: 0, dockMaterial: "glass", dockBlur: 32 });
    expect(parseWidgetSettings({ ...old, dockOpacity: 45, dockMaterial: "translucent", dockBlur: 0 })).toMatchObject({ dockOpacity: 45, dockMaterial: "translucent", dockBlur: 0 });
    for (const dockOpacity of [-1, 101, 40.5, null, "50"]) expect(() => parseWidgetSettings({ ...old, dockOpacity })).toThrow("透明度");
    for (const dockMaterial of ["acrylic", null, 1]) expect(() => parseWidgetSettings({ ...old, dockMaterial })).toThrow("材质");
    for (const dockBlur of [-1, 33, 1.5, null, "16"]) expect(() => parseWidgetSettings({ ...old, dockBlur })).toThrow("模糊强度");
  });
  it("accepts compact 20px icon geometry and rejects values below the new bounds", () => {
    expect(parseWidgetSettings({ ...DEFAULT_WIDGET_SETTINGS, iconSize: 20, longSide: 96, thickness: 40 })).toMatchObject({ iconSize: 20, longSide: 96, thickness: 40 });
    expect(() => parseWidgetSettings({ ...DEFAULT_WIDGET_SETTINGS, iconSize: 19 })).toThrow("图标");
  });
  it("defaults old settings to one row and round-trips the chosen rows", () => {
    expect(DEFAULT_WIDGET_SETTINGS.rows).toBe(1);
    const legacy = { ...DEFAULT_WIDGET_SETTINGS } as Record<string, unknown>;
    delete legacy.rows;
    expect(parseWidgetSettings(legacy).rows).toBe(1);
    expect(parseWidgetSettings({ ...legacy, rows: 2 }).rows).toBe(2);
    expect(() => parseWidgetSettings({ ...legacy, rows: 0 })).toThrow("排数");
  });
  it("defaults to visible modules without collecting clipboard history", () => {
    expect(DEFAULT_WIDGET_SETTINGS.enabledContentIds).toEqual(
      CONTENT_REGISTRY.filter(({ id }) => id !== "clipboard").map(({ id }) => id),
    );
    expect(CONTENT_REGISTRY.some(({ id }) => id === "clipboard")).toBe(true);
    expect(DEFAULT_WIDGET_SETTINGS.schemaVersion).toBe(5);
    expect(DEFAULT_WIDGET_SETTINGS.enabledContentIds).toContain("codex");
    expect(DEFAULT_WIDGET_SETTINGS.enabledContentIds).toContain("weather");
    expect(DEFAULT_WIDGET_SETTINGS.weather).toBeNull();
    expect(DEFAULT_WIDGET_SETTINGS.visibility).toBe("always");
  });

  it("preserves a valid enabled module order and display settings", () => {
    const parsed = parseWidgetSettings({
      ...DEFAULT_WIDGET_SETTINGS,
      enabledContentIds: ["memory", "todo"],
      edge: "right",
      edgeOffset: 0.25,
      longSide: 420,
      thickness: 96,
      iconSize: 40,
      visibility: "hidden",
    });

    expect(parsed).toMatchObject({
      enabledContentIds: ["memory", "todo"],
      edge: "right",
      edgeOffset: 0.5,
      longSide: 420,
      thickness: 96,
      iconSize: 40,
      visibility: "hidden",
    });
  });

  it("preserves an explicit clipboard opt-in in current settings", () => {
    expect(parseWidgetSettings({
      ...DEFAULT_WIDGET_SETTINGS,
      enabledContentIds: ["clipboard", "todo"],
    }).enabledContentIds).toEqual(["clipboard", "todo"]);
  });

  it("turns off legacy clipboard collection while preserving other modules' order", () => {
    const migrated = parseWidgetSettings({
      ...DEFAULT_WIDGET_SETTINGS,
      schemaVersion: 4,
      enabledContentIds: ["memory", "clipboard", "todo"],
    });
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.enabledContentIds).toEqual(["memory", "todo"]);

    expect(parseWidgetSettings({
      ...migrated,
      enabledContentIds: ["memory", "clipboard", "todo"],
    }).enabledContentIds).toEqual(["memory", "clipboard", "todo"]);
  });

  it("drops the retired hardware temperature module while preserving other legacy modules", () => {
    expect(
      parseWidgetSettings({
        ...DEFAULT_WIDGET_SETTINGS,
        enabledContentIds: ["cpu", "temperature", "gpu", "memory"],
      }).enabledContentIds,
    ).toEqual(["cpu", "gpu", "memory"]);
  });

  it("migrates schema version 1 by appending the implemented media and Codex modules", () => {
    const legacy = {
      ...DEFAULT_WIDGET_SETTINGS,
      schemaVersion: 1,
      enabledContentIds: ["todo", "memory"],
    };

    expect(parseWidgetSettings(legacy)).toMatchObject({
      schemaVersion: 5,
      enabledContentIds: ["todo", "memory", "media", "codex", "weather"],
    });
  });

  it("migrates schema version 2 by appending Codex without reordering existing modules", () => {
    const versionTwo = {
      ...DEFAULT_WIDGET_SETTINGS,
      schemaVersion: 2,
      enabledContentIds: ["memory", "todo"],
    };

    expect(parseWidgetSettings(versionTwo)).toMatchObject({
      schemaVersion: 5,
      enabledContentIds: ["memory", "todo", "codex", "weather"],
    });
  });

  it("migrates schema version 3 by appending Weather without reordering existing modules", () => {
    expect(
      parseWidgetSettings({
        ...DEFAULT_WIDGET_SETTINGS,
        schemaVersion: 3,
        enabledContentIds: ["todo", "memory"],
      }).enabledContentIds,
    ).toEqual(["todo", "memory", "weather"]);
  });

  it("preserves an explicit Weather opt-out in schema version 4", () => {
    expect(
      parseWidgetSettings({
        ...DEFAULT_WIDGET_SETTINGS,
        schemaVersion: 4,
        enabledContentIds: ["todo", "memory"],
      }).enabledContentIds,
    ).toEqual(["todo", "memory"]);
  });

  it("accepts an explicit weather location and rejects auto-location or invalid coordinates", () => {
    expect(parseWidgetSettings({
      ...DEFAULT_WIDGET_SETTINGS,
      weather: {
        name: "杭州",
        latitude: 30.2741,
        longitude: 120.1551,
        timezone: "Asia/Shanghai",
        temperatureUnit: "celsius",
      },
    }).weather).toEqual({
      name: "杭州",
      latitude: 30.2741,
      longitude: 120.1551,
      timezone: "Asia/Shanghai",
      temperatureUnit: "celsius",
    });

    expect(() => parseWidgetSettings({
      ...DEFAULT_WIDGET_SETTINGS,
      weather: {
        name: "自动定位",
        latitude: 0,
        longitude: 0,
        timezone: "auto",
        temperatureUnit: "celsius",
      },
    })).toThrow("时区");
    expect(() => parseWidgetSettings({
      ...DEFAULT_WIDGET_SETTINGS,
      weather: {
        name: "无效位置",
        latitude: 91,
        longitude: 0,
        timezone: "UTC",
        temperatureUnit: "celsius",
      },
    })).toThrow("纬度");
    expect(() => parseWidgetSettings({
      ...DEFAULT_WIDGET_SETTINGS,
      weather: {
        name: "不存在的时区",
        latitude: 30,
        longitude: 120,
        timezone: "Foo/Bar",
        temperatureUnit: "celsius",
      },
    })).toThrow("IANA 时区");
  });

  it("rejects unknown and repeated content IDs", () => {
    expect(() =>
      parseWidgetSettings({
        ...DEFAULT_WIDGET_SETTINGS,
        enabledContentIds: ["todo", "future-module"],
      }),
    ).toThrow("未知项");
    expect(() =>
      parseWidgetSettings({
        ...DEFAULT_WIDGET_SETTINGS,
        enabledContentIds: ["todo", "todo"],
      }),
    ).toThrow("重复项");
  });

  it("rejects invalid geometry, edge, and visibility values", () => {
    expect(() =>
      parseWidgetSettings({ ...DEFAULT_WIDGET_SETTINGS, edge: "center" }),
    ).toThrow("边缘");
    expect(() =>
      parseWidgetSettings({ ...DEFAULT_WIDGET_SETTINGS, edgeOffset: 1.1 }),
    ).toThrow("边缘范围");
    expect(() =>
      parseWidgetSettings({ ...DEFAULT_WIDGET_SETTINGS, iconSize: 19 }),
    ).toThrow("图标直径");
    expect(() =>
      parseWidgetSettings({ ...DEFAULT_WIDGET_SETTINGS, visibility: "hover" }),
    ).toThrow("显示方式");
  });

  it("allows an empty module list without inventing module data", () => {
    expect(
      parseWidgetSettings({ ...DEFAULT_WIDGET_SETTINGS, enabledContentIds: [] })
        .enabledContentIds,
    ).toEqual([]);
  });
});
