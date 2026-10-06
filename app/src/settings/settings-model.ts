import type { ShellEdge } from "../shell/shell-layout";
import type { IconName } from "../shell/LocalIcon";

export const CONTENT_REGISTRY = [
  { id: "todo", label: "待办", symbol: "✓", icon: "list-checks", description: "本地任务" },
  { id: "focus", label: "专注", symbol: "◷", icon: "clock", description: "专注计时" },
  { id: "cpu", label: "CPU", symbol: "CPU", icon: "cpu", description: "处理器占用" },
  { id: "gpu", label: "GPU", symbol: "GPU", icon: "gpu", description: "图形处理器占用" },

  { id: "memory", label: "内存", symbol: "▥", icon: "memory-stick", description: "内存占用" },
  { id: "media", label: "媒体", symbol: "♫", icon: "music", description: "媒体播放状态" },
  { id: "codex", label: "Codex", symbol: "C", icon: "square-terminal", description: "官方额度" },
  { id: "weather", label: "天气", symbol: "☼", icon: "sun", description: "城市天气" },
  { id: "clipboard", label: "剪贴板", symbol: "▤", icon: "clipboard-list", description: "纯文本历史" },
] as const;

export type ContentIcon = IconName;

export type ContentId = (typeof CONTENT_REGISTRY)[number]["id"];
export type VisibilityMode = "always" | "hidden";
export type TemperatureUnit = "celsius" | "fahrenheit";
export type DockMaterial = "solid" | "translucent" | "glass";

export type WeatherLocationSettings = {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  temperatureUnit: TemperatureUnit;
};

export type WidgetSettings = {
  schemaVersion: 5;
  enabledContentIds: ContentId[];
  edge: ShellEdge;
  edgeOffset: number;
  longSide: number;
  thickness: number;
  iconSize: number;
  dockOpacity?: number;
  dockMaterial: DockMaterial;
  dockBlur: number;
  rows: number;
  visibility: VisibilityMode;
  weather: WeatherLocationSettings | null;
};

export type SettingsLoadResult = {
  settings: WidgetSettings;
  notice: string | null;
};

export const SETTING_LIMITS = {
  longSide: { minimum: 96, maximum: 720 },
  thickness: { minimum: 40, maximum: 240 },
  iconSize: { minimum: 20, maximum: 52 },
} as const;

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  schemaVersion: 5,
  enabledContentIds: CONTENT_REGISTRY.filter(({ id }) => id !== "clipboard").map(({ id }) => id),
  edge: "top",
  edgeOffset: 0.5,
  longSide: 260,
  thickness: 80,
  iconSize: 46,
  dockOpacity: 100,
  dockMaterial: "solid",
  dockBlur: 16,
  rows: 1,
  visibility: "always",
  weather: null,
};

const contentIds = new Set<string>(CONTENT_REGISTRY.map(({ id }) => id));
const edges = new Set<ShellEdge>(["top", "right", "bottom", "left"]);
const visibilityModes = new Set<VisibilityMode>(["always", "hidden"]);
const temperatureUnits = new Set<TemperatureUnit>(["celsius", "fahrenheit"]);
const dockMaterials = new Set<DockMaterial>(["solid", "translucent", "glass"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function isIanaTimezone(value: string): boolean {
  if (!value || value === "auto") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function parseWeatherLocation(value: unknown): WeatherLocationSettings | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("天气位置不是对象。");
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (name.length === 0 || name.length > 80) throw new Error("天气城市名称无效。");
  if (
    typeof value.latitude !== "number" ||
    !Number.isFinite(value.latitude) ||
    value.latitude < -90 ||
    value.latitude > 90
  ) {
    throw new Error("天气纬度必须在 -90 到 90 之间。");
  }
  if (
    typeof value.longitude !== "number" ||
    !Number.isFinite(value.longitude) ||
    value.longitude < -180 ||
    value.longitude > 180
  ) {
    throw new Error("天气经度必须在 -180 到 180 之间。");
  }
  if (typeof value.timezone !== "string" || !isIanaTimezone(value.timezone)) {
    throw new Error("天气时区必须是明确的 IANA 时区，不能自动定位。");
  }
  if (
    typeof value.temperatureUnit !== "string" ||
    !temperatureUnits.has(value.temperatureUnit as TemperatureUnit)
  ) {
    throw new Error("天气温度单位无效。");
  }
  return {
    name,
    latitude: value.latitude,
    longitude: value.longitude,
    timezone: value.timezone,
    temperatureUnit: value.temperatureUnit as TemperatureUnit,
  };
}

export function parseWidgetSettings(value: unknown): WidgetSettings {
  if (!isRecord(value)) throw new Error("设置内容不是对象。");
  if (
    value.schemaVersion !== 1 &&
    value.schemaVersion !== 2 &&
    value.schemaVersion !== 3 &&
    value.schemaVersion !== 4 &&
    value.schemaVersion !== 5
  ) {
    throw new Error("设置版本不受支持。");
  }
  if (!Array.isArray(value.enabledContentIds)) throw new Error("模块顺序缺失。");

  const ids = value.enabledContentIds.filter((id) => id !== "temperature");
  if (
    !ids.every((id): id is ContentId => typeof id === "string" && contentIds.has(id)) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error("模块列表包含未知项或重复项。");
  }
  if (typeof value.edge !== "string" || !edges.has(value.edge as ShellEdge)) {
    throw new Error("停靠边缘无效。");
  }
  if (typeof value.edgeOffset !== "number" || !Number.isFinite(value.edgeOffset) || value.edgeOffset < 0 || value.edgeOffset > 1) {
    throw new Error("停靠位置必须在边缘范围内。");
  }
  if (!isIntegerInRange(value.longSide, SETTING_LIMITS.longSide.minimum, SETTING_LIMITS.longSide.maximum)) {
    throw new Error("卡片长边超出支持范围。");
  }
  if (!isIntegerInRange(value.thickness, SETTING_LIMITS.thickness.minimum, SETTING_LIMITS.thickness.maximum)) {
    throw new Error("卡片厚度超出支持范围。");
  }
  if (!isIntegerInRange(value.iconSize, SETTING_LIMITS.iconSize.minimum, SETTING_LIMITS.iconSize.maximum)) {
    throw new Error("图标直径超出支持范围。");
  }
  const rows = value.rows === undefined ? 1 : value.rows;
  const dockOpacity = value.dockOpacity === undefined ? 100 : value.dockOpacity;
  const dockMaterial = value.dockMaterial === undefined ? "solid" : value.dockMaterial;
  const dockBlur = value.dockBlur === undefined ? 16 : value.dockBlur;
  if (!isIntegerInRange(dockOpacity, 0, 100)) throw new Error("导航条透明度必须在 0–100 之间。");
  if (typeof dockMaterial !== "string" || !dockMaterials.has(dockMaterial as DockMaterial)) {
    throw new Error("导航条背景材质无效。");
  }
  if (!isIntegerInRange(dockBlur, 0, 32)) throw new Error("导航条模糊强度必须在 0–32 之间。");
  if (!isIntegerInRange(rows, 1, 4)) throw new Error("模块排数必须在 1 到 4 之间。");
  if (typeof value.visibility !== "string" || !visibilityModes.has(value.visibility as VisibilityMode)) {
    throw new Error("显示方式无效。");
  }
  const weather = value.schemaVersion < 4 ? null : parseWeatherLocation(value.weather);

  const enabledContentIds = [...ids];
  if (value.schemaVersion === 1 && !enabledContentIds.includes("media")) {
    enabledContentIds.push("media");
  }
  if (value.schemaVersion < 3 && !enabledContentIds.includes("codex")) {
    enabledContentIds.push("codex");
  }
  if (value.schemaVersion < 4 && !enabledContentIds.includes("weather")) {
    enabledContentIds.push("weather");
  }
  if (value.schemaVersion < 5) {
    const clipboardIndex = enabledContentIds.indexOf("clipboard");
    if (clipboardIndex !== -1) enabledContentIds.splice(clipboardIndex, 1);
  }
  return {
    schemaVersion: 5,
    enabledContentIds,
    edge: value.edge as ShellEdge,
    edgeOffset: 0.5,
    longSide: value.longSide,
    thickness: value.thickness,
    iconSize: value.iconSize,
    dockOpacity,
    dockMaterial: dockMaterial as DockMaterial,
    dockBlur,
    rows,
    visibility: value.visibility as VisibilityMode,
    weather,
  };
}
