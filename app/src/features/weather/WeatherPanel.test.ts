import { readFileSync } from "node:fs";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WeatherPanel } from "./WeatherPanel";
import { parseWeatherReadState, type WeatherReadState } from "./weather-model";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/weather/fresh-celsius.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

function renderPanel(state: WeatherReadState): string {
  return renderToStaticMarkup(createElement(WeatherPanel, {
    location: state.snapshot?.location ?? null,
    state,
    isRefreshing: false,
    closeButtonRef: createRef<HTMLButtonElement>(),
    onClose: () => undefined,
  }));
}

describe("WeatherPanel", () => {
  it("does not use a failed attempt time as the provider data update time", () => {
    const state: WeatherReadState = {
      schemaVersion: 1,
      quality: "unavailable",
      snapshot: null,
      failureReason: "network",
      retryAfterMs: 60_000,
      lastAttemptAtMs: 1_790_557_200_000,
    };

    expect(renderPanel(state)).toContain("尚无更新时间");
    expect(renderPanel(state)).not.toContain("经纬度");
    expect(renderPanel(state)).not.toContain("IANA 时区");
  });

  it("does not crash if an untrusted snapshot contains an unknown timezone", () => {
    const invalid = structuredClone(fixture);
    const snapshot = invalid.snapshot as Record<string, unknown>;
    snapshot.providerTimezone = "Foo/Bar";
    const location = snapshot.location as Record<string, unknown>;
    location.timezone = "Foo/Bar";
    const state = invalid as unknown as WeatherReadState;

    expect(() => renderPanel(state)).not.toThrow();
    expect(renderPanel(state)).toContain("时间不可用");
  });

  it("renders a validated fresh weather fixture", () => {
    expect(renderPanel(parseWeatherReadState(fixture))).toContain("来源：Open-Meteo");
  });
});