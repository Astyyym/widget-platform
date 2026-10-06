import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalIcon } from "../../shell/LocalIcon";
import type { WeatherLocationSettings } from "../../settings/settings-model";
import { WeatherPanel } from "./WeatherPanel";
import { INITIAL_WEATHER_STATE, type WeatherReadState } from "./weather-model";

const location: WeatherLocationSettings = {
  name: "合成测试城市", latitude: 0, longitude: 0, timezone: "Etc/UTC", temperatureUnit: "celsius",
};
const fresh: WeatherReadState = {
  ...INITIAL_WEATHER_STATE, quality: "fresh", failureReason: null,
  snapshot: { schemaVersion: 1, source: "Open-Meteo", location, providerTimezone: "Etc/UTC", observedAtMs: 10_000,
    current: { temperature: 23, weatherCode: 0 }, daily: { highTemperature: 26, lowTemperature: 18, weatherCode: 0 },
    hourly: [{ atMs: 20_000, temperature: 24, weatherCode: 999 }] },
};

describe("Weather panel local return icon", () => {
  it("keeps one decorative 16px arrow without replacing weather text or unavailable states", () => {
    const arrow = renderToStaticMarkup(createElement(LocalIcon, { name: "x", size: 16 }));
    for (const state of [INITIAL_WEATHER_STATE, fresh,
      { ...fresh, quality: "stale" as const, failureReason: "network" as const, lastAttemptAtMs: 30_000 },
      { ...INITIAL_WEATHER_STATE, failureReason: "network" as const, lastAttemptAtMs: 30_000 }]) {
      for (const configured of [false, true]) for (const isRefreshing of [false, true]) {
        const markup = renderToStaticMarkup(createElement(WeatherPanel, {
          location: configured ? location : null, state, isRefreshing,
          closeButtonRef: createRef<HTMLButtonElement>(), onClose: () => undefined,
        }));
        expect(markup).toContain('aria-label="关闭详情" class="shell-panel-close"');
        expect(markup).toContain(arrow);
        expect(markup.match(/class="local-icon"/g)).toHaveLength(1);
        expect(markup).not.toContain("×");
        expect(markup).toContain("来源：Open-Meteo");
        if (!configured) expect(markup).toContain("尚未配置城市");
        else if (state.snapshot) {
          for (const text of ["23°C", "26°C", "18°C", "小时预报", "天气代码 999"]) expect(markup).toContain(text);
        } else expect(markup).toContain("尚无更新时间");
      }
    }
  });
});
