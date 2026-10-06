import {
  isIanaTimezone,
  type WeatherLocationSettings,
} from "../../settings/settings-model";

export type WeatherQuality = "fresh" | "stale" | "unavailable";
export type WeatherFailureReason =
  | "notConnected"
  | "network"
  | "rateLimited"
  | "invalidResponse"
  | "cancelled"
  | "transport";

export type WeatherPoint = {
  atMs: number;
  temperature: number;
  weatherCode: number;
};

export type WeatherSnapshot = {
  schemaVersion: 1;
  source: "Open-Meteo";
  location: WeatherLocationSettings;
  providerTimezone: string;
  observedAtMs: number;
  current: {
    temperature: number;
    weatherCode: number;
  };
  daily: {
    highTemperature: number;
    lowTemperature: number;
    weatherCode: number;
  };
  hourly: WeatherPoint[];
};

export type WeatherReadState = {
  schemaVersion: 1;
  quality: WeatherQuality;
  snapshot: WeatherSnapshot | null;
  failureReason: WeatherFailureReason | null;
  retryAfterMs: number;
  lastAttemptAtMs: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isWeatherCode(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseLocation(value: unknown): WeatherLocationSettings {
  if (!isRecord(value)) throw new Error("天气数据中的位置无效。");
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const timezone = typeof value.timezone === "string" ? value.timezone : "";
  const temperatureUnit = value.temperatureUnit;
  if (
    name.length === 0 ||
    name.length > 80 ||
    !isFiniteNumber(value.latitude) ||
    value.latitude < -90 ||
    value.latitude > 90 ||
    !isFiniteNumber(value.longitude) ||
    value.longitude < -180 ||
    value.longitude > 180 ||
    !isIanaTimezone(timezone) ||
    (temperatureUnit !== "celsius" && temperatureUnit !== "fahrenheit")
  ) {
    throw new Error("天气数据中的位置字段无效。");
  }
  return {
    name,
    latitude: value.latitude,
    longitude: value.longitude,
    timezone,
    temperatureUnit,
  };
}

function parseWeatherPoint(value: unknown): WeatherPoint {
  if (
    !isRecord(value) ||
    !isSafeTimestamp(value.atMs) ||
    !isFiniteNumber(value.temperature) ||
    !isWeatherCode(value.weatherCode)
  ) {
    throw new Error("天气数据中的小时预报无效。");
  }
  return {
    atMs: value.atMs,
    temperature: value.temperature,
    weatherCode: value.weatherCode,
  };
}

function parseSnapshot(value: unknown): WeatherSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.source !== "Open-Meteo") {
    throw new Error("天气数据快照无效。");
  }
  const location = parseLocation(value.location);
  if (
    typeof value.providerTimezone !== "string" ||
    !isIanaTimezone(value.providerTimezone) ||
    !isSafeTimestamp(value.observedAtMs) ||
    !isRecord(value.current) ||
    !isFiniteNumber(value.current.temperature) ||
    !isWeatherCode(value.current.weatherCode) ||
    !isRecord(value.daily) ||
    !isFiniteNumber(value.daily.highTemperature) ||
    !isFiniteNumber(value.daily.lowTemperature) ||
    !isWeatherCode(value.daily.weatherCode) ||
    !Array.isArray(value.hourly) ||
    value.hourly.length === 0 ||
    value.hourly.length > 48
  ) {
    throw new Error("天气数据字段无效。");
  }
  const hourly = value.hourly.map(parseWeatherPoint);
  if (value.daily.lowTemperature > value.daily.highTemperature) {
    throw new Error("天气数据中的高低温无效。");
  }
  return {
    schemaVersion: 1,
    source: "Open-Meteo",
    location,
    providerTimezone: value.providerTimezone,
    observedAtMs: value.observedAtMs,
    current: {
      temperature: value.current.temperature,
      weatherCode: value.current.weatherCode,
    },
    daily: {
      highTemperature: value.daily.highTemperature,
      lowTemperature: value.daily.lowTemperature,
      weatherCode: value.daily.weatherCode,
    },
    hourly,
  };
}

export function parseWeatherReadState(value: unknown): WeatherReadState {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("天气数据格式无效。");
  }
  const qualities: readonly WeatherQuality[] = ["fresh", "stale", "unavailable"];
  const failures: readonly WeatherFailureReason[] = [
    "notConnected",
    "network",
    "rateLimited",
    "invalidResponse",
    "cancelled",
    "transport",
  ];
  if (
    !qualities.includes(value.quality as WeatherQuality) ||
    !isSafeTimestamp(value.retryAfterMs) ||
    (value.lastAttemptAtMs !== null && !isSafeTimestamp(value.lastAttemptAtMs)) ||
    (value.failureReason !== null && !failures.includes(value.failureReason as WeatherFailureReason))
  ) {
    throw new Error("天气数据状态无效。");
  }
  const quality = value.quality as WeatherQuality;
  const snapshot = value.snapshot === null ? null : parseSnapshot(value.snapshot);
  const failureReason = value.failureReason as WeatherFailureReason | null;
  if (
    (quality === "fresh" && (snapshot === null || failureReason !== null)) ||
    (quality === "stale" && (snapshot === null || failureReason === null)) ||
    (quality === "unavailable" && snapshot !== null)
  ) {
    throw new Error("天气数据质量与快照不一致。");
  }
  return {
    schemaVersion: 1,
    quality,
    snapshot,
    failureReason,
    retryAfterMs: value.retryAfterMs,
    lastAttemptAtMs: value.lastAttemptAtMs as number | null,
  };
}

export function describeWeatherCode(code: number): string {
  if (code === 0) return "晴";
  if (code === 1 || code === 2) return "晴间多云";
  if (code === 3) return "阴";
  if (code === 45 || code === 48) return "有雾";
  if ([51, 53, 55, 56, 57].includes(code)) return "毛毛雨";
  if ([61, 63, 80, 81].includes(code)) return "小雨";
  if ([65, 66, 67, 82].includes(code)) return "大雨";
  if ([71, 73, 77, 85].includes(code)) return "小雪";
  if ([75, 86].includes(code)) return "大雪";
  if ([95, 96, 99].includes(code)) return "雷暴";
  return `天气代码 ${code}`;
}

function unitSymbol(snapshot: WeatherSnapshot): string {
  return snapshot.location.temperatureUnit === "celsius" ? "°C" : "°F";
}

function rounded(value: number): string {
  return Math.round(value).toString();
}

export function formatWeatherSummary(state: WeatherReadState): string {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return state.failureReason === "notConnected" ? "等待天气配置" : "天气数据不可用";
  }
  const summary = `${describeWeatherCode(snapshot.current.weatherCode)} · ${rounded(snapshot.current.temperature)}${unitSymbol(snapshot)} · ${rounded(snapshot.daily.lowTemperature)}–${rounded(snapshot.daily.highTemperature)}${unitSymbol(snapshot)}`;
  return state.quality === "stale" ? `更新失败 · ${summary}` : summary;
}

export function weatherSymbol(state: WeatherReadState): string {
  const code = state.snapshot?.current.weatherCode;
  if (code === undefined) return "?";
  if (code <= 1) return "☀";
  if (code <= 3) return "☁";
  if (code === 45 || code === 48) return "≋";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "☂";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "❄";
  if (code >= 95) return "ϟ";
  return "?";
}

/** Formats an hourly point timestamp as a short local clock label (e.g. "14:00"). */
export function formatWeatherTime(timestampMs: number, timezone: string): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return "时间不可用";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return "时间不可用";
  }
}

export const HOURLY_WINDOW_SIZE = 12;
/** Number of points shown before the reference hour, so "now" sits at index 3. */
export const HOURLY_POINTS_BEFORE_NOW = 3;

/**
 * Selects a fixed-size window of hourly points with the reference hour anchored
 * at index `HOURLY_POINTS_BEFORE_NOW` (the 4th point), showing recent past on the
 * left and upcoming hours on the right.
 *
 * The reference is the snapshot's observation time, which shares the provider
 * timezone with the hourly points. If the reference falls outside the available
 * range (e.g. stale data whose hourly array no longer covers "now"), the window
 * clamps to the nearest edge instead of failing.
 */
export function selectHourlyWindow(
  hourly: readonly WeatherPoint[],
  observedAtMs: number,
  size: number = HOURLY_WINDOW_SIZE,
): WeatherPoint[] {
  if (hourly.length === 0) return [];
  if (hourly.length <= size) return [...hourly];

  // Nearest point to the reference time (points are ascending by atMs).
  let referenceIndex = 0;
  let smallestGap = Number.POSITIVE_INFINITY;
  hourly.forEach((point, index) => {
    const gap = Math.abs(point.atMs - observedAtMs);
    if (gap < smallestGap) {
      smallestGap = gap;
      referenceIndex = index;
    }
  });

  let start = referenceIndex - HOURLY_POINTS_BEFORE_NOW;
  start = Math.max(0, Math.min(start, hourly.length - size));
  return hourly.slice(start, start + size);
}

export const INITIAL_WEATHER_STATE: WeatherReadState = {
  schemaVersion: 1,
  quality: "unavailable",
  snapshot: null,
  failureReason: "notConnected",
  retryAfterMs: 30 * 60_000,
  lastAttemptAtMs: null,
};
