import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeWeatherCode,
  formatWeatherSummary,
  parseWeatherReadState,
  selectHourlyWindow,
  weatherSymbol,
  type WeatherPoint,
} from "./weather-model";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/weather/fresh-celsius.json", import.meta.url),
    "utf8",
  ),
) as unknown;

describe("weather model", () => {
  it("parses a normalized current, daily, and hourly snapshot", () => {
    const state = parseWeatherReadState(fixture);

    expect(state.quality).toBe("fresh");
    expect(state.snapshot).toMatchObject({
      source: "Open-Meteo",
      providerTimezone: "Asia/Shanghai",
      current: { temperature: 22.4, weatherCode: 1 },
      daily: { highTemperature: 26.1, lowTemperature: 17.8, weatherCode: 2 },
    });
    expect(state.snapshot?.hourly).toHaveLength(3);
    expect(formatWeatherSummary(state)).toBe("晴间多云 · 22°C · 18–26°C");
    expect(weatherSymbol(state)).toBe("☀");
  });

  it("keeps last-good data visibly stale without changing its observation time", () => {
    const raw = structuredClone(fixture) as Record<string, unknown>;
    raw.quality = "stale";
    raw.failureReason = "network";
    raw.lastAttemptAtMs = 1_790_559_000_000;

    const state = parseWeatherReadState(raw);

    expect(state.snapshot?.observedAtMs).toBe(1_790_557_200_000);
    expect(formatWeatherSummary(state)).toBe("更新失败 · 晴间多云 · 22°C · 18–26°C");
  });

  it("rejects unsupported units, invalid coordinates, and empty hourly forecasts", () => {
    const wrongUnit = structuredClone(fixture) as any;
    wrongUnit.snapshot.location.temperatureUnit = "kelvin";
    expect(() => parseWeatherReadState(wrongUnit)).toThrow("天气数据");

    const wrongLatitude = structuredClone(fixture) as any;
    wrongLatitude.snapshot.location.latitude = 91;
    expect(() => parseWeatherReadState(wrongLatitude)).toThrow("天气数据");

    const emptyHourly = structuredClone(fixture) as any;
    emptyHourly.snapshot.hourly = [];
    expect(() => parseWeatherReadState(emptyHourly)).toThrow("天气数据");
  });

  it("maps WMO weather codes without inventing unsupported conditions", () => {
    expect(describeWeatherCode(0)).toBe("晴");
    expect(describeWeatherCode(61)).toBe("小雨");
    expect(describeWeatherCode(95)).toBe("雷暴");
    expect(describeWeatherCode(999)).toBe("天气代码 999");
  });

  describe("selectHourlyWindow", () => {
    const HOUR = 3_600_000;
    function series(count: number, startMs = 0): WeatherPoint[] {
      return Array.from({ length: count }, (_, index) => ({
        atMs: startMs + index * HOUR,
        temperature: 10 + index,
        weatherCode: 0,
      }));
    }

    it("anchors the reference hour at the 4th point (index 3)", () => {
      const hourly = series(24);
      const referenceMs = hourly[10].atMs;
      const window = selectHourlyWindow(hourly, referenceMs);
      expect(window).toHaveLength(12);
      expect(window[3].atMs).toBe(referenceMs);
      expect(window[0].atMs).toBe(hourly[7].atMs);
      expect(window[11].atMs).toBe(hourly[18].atMs);
    });

    it("clamps to the start when the reference is near the beginning", () => {
      const hourly = series(24);
      const window = selectHourlyWindow(hourly, hourly[0].atMs);
      expect(window).toHaveLength(12);
      expect(window[0].atMs).toBe(hourly[0].atMs);
    });

    it("clamps to the end when the reference is near the end", () => {
      const hourly = series(24);
      const window = selectHourlyWindow(hourly, hourly[23].atMs);
      expect(window).toHaveLength(12);
      expect(window[11].atMs).toBe(hourly[23].atMs);
    });

    it("returns the whole series unchanged when it is shorter than the window", () => {
      const hourly = series(5);
      expect(selectHourlyWindow(hourly, hourly[2].atMs)).toEqual(hourly);
      expect(selectHourlyWindow([], 0)).toEqual([]);
    });

    it("picks the nearest point when the reference falls between hours", () => {
      const hourly = series(24);
      const betweenMs = hourly[10].atMs + HOUR * 0.6;
      const window = selectHourlyWindow(hourly, betweenMs);
      expect(window[3].atMs).toBe(hourly[11].atMs);
    });
  });
});
