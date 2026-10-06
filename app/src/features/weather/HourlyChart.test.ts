import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HourlyChart } from "./HourlyChart";
import { formatWeatherTime, type WeatherPoint } from "./weather-model";

const HOUR = 3_600_000;

function series(count: number): WeatherPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    atMs: index * HOUR,
    temperature: 10 + index,
    weatherCode: 0,
  }));
}

function render(points: WeatherPoint[], mode: "preview" | "detail"): string {
  return renderToStaticMarkup(
    createElement(HourlyChart, {
      points,
      unitSymbol: "°C",
      timezone: "Etc/UTC",
      mode,
      formatTime: formatWeatherTime,
    }),
  );
}

function bandItemCount(markup: string): number {
  return markup.match(/weather-chart-band-item/g)?.length ?? 0;
}

describe("HourlyChart", () => {
  it("renders every point as a dot but only every other point in the detail band", () => {
    const markup = render(series(12), "detail");
    // 12 dots on the line.
    expect(markup.match(/weather-chart-dot/g)).toHaveLength(12);
    // 6 band items (indices 0,2,4,6,8,10).
    expect(bandItemCount(markup)).toBe(6);
  });

  it("never renders the detail band in preview mode", () => {
    const markup = render(series(12), "preview");
    expect(markup).toContain('data-mode="preview"');
    expect(markup).not.toContain("weather-chart-band");
    expect(markup).not.toContain("weather-chart-extremes");
  });

  it("still shows a single point's band item without crowding logic breaking", () => {
    const markup = render(series(1), "detail");
    expect(bandItemCount(markup)).toBe(1);
  });
});
