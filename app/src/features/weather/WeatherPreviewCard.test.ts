import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WeatherPreviewCard } from "./WeatherPreviewCard";
import { formatWeatherTime, parseWeatherReadState } from "./weather-model";
import type { WeatherLocationSettings } from "../../settings/settings-model";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/weather/fresh-celsius.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

const location: WeatherLocationSettings = {
  name: "测试城市",
  latitude: 30.2741,
  longitude: 120.1551,
  timezone: "Asia/Shanghai",
  temperatureUnit: "celsius",
};

function render(state: unknown, loc: WeatherLocationSettings | null = location): string {
  return renderToStaticMarkup(
    createElement(WeatherPreviewCard, {
      location: loc,
      state: parseWeatherReadState(state),
      formatTime: formatWeatherTime,
    }),
  );
}

describe("WeatherPreviewCard", () => {
  it("shows city, current temperature, condition, and a display-only chart", () => {
    const markup = render(fixture);
    expect(markup).toContain("测试城市");
    expect(markup).toContain("22°C");
    expect(markup).toContain("晴间多云");
    // Preview mode: chart present but no detail-only animation/extremes/band.
    expect(markup).toContain('data-mode="preview"');
    expect(markup).not.toContain("weather-chart-extremes");
    expect(markup).not.toContain("weather-chart-band");
  });

  it("falls back to guidance when no location is configured", () => {
    expect(render(fixture, null)).toContain("请在设置中填写城市名称");
  });

  it("falls back to an empty message when there is no snapshot", () => {
    const state = { ...fixture, quality: "unavailable", snapshot: null, failureReason: "network" };
    expect(render(state)).toContain("当前没有可用天气数据");
  });
});
