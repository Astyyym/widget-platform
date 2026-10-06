import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONTENT_REGISTRY } from "../settings/settings-model";
import { ICON_SOURCES, LocalIcon, resolveSummaryIcon, resolveWeatherCodeIcon } from "./LocalIcon";

describe("local icon mappings", () => {
  it("maps semantic module states without replacing readouts", () => {
    expect(resolveSummaryIcon("todo", "✓")).toBe("check");
    expect(resolveSummaryIcon("todo", "○")).toBe("circle");
    expect(resolveSummaryIcon("todo", "1/3", "readout")).toBeNull();
    expect(resolveSummaryIcon("focus", "◷")).toBe("clock");
    expect(resolveSummaryIcon("focus", "⌛")).toBe("timer");
    expect(resolveSummaryIcon("focus", "🔔")).toBe("bell-ring");
    expect(resolveSummaryIcon("media", "Ⅱ")).toBe("pause");
    expect(resolveSummaryIcon("media", "▶")).toBe("play");
    expect(resolveSummaryIcon("media", "♫")).toBe("music");
    expect(resolveSummaryIcon("clipboard", "▤")).toBe("clipboard-list");
  });

  it("keeps configured unavailable weather distinct from unconfigured or unknown weather", () => {
    expect(resolveSummaryIcon("weather", "cloud-off")).toBe("cloud-off");
    expect(resolveSummaryIcon("weather", "☀")).toBe("sun");
    expect(resolveSummaryIcon("weather", "☼")).toBe("sun");
    expect(resolveSummaryIcon("weather", "☁")).toBe("cloud-sun");
    expect(resolveSummaryIcon("weather", "≋")).toBe("cloud-fog");
    expect(resolveSummaryIcon("weather", "☂")).toBe("cloud-rain");
    expect(resolveSummaryIcon("weather", "❄")).toBe("cloud-snow");
    expect(resolveSummaryIcon("weather", "ϟ")).toBe("cloud-lightning");
    expect(resolveSummaryIcon("weather", "?")).toBeNull();
  });

  it("maps exact weather-code groups and leaves unknown codes without a guessed icon", () => {
    expect(resolveWeatherCodeIcon(0)).toBe("sun");
    expect(resolveWeatherCodeIcon(1)).toBe("cloud-sun");
    expect(resolveWeatherCodeIcon(2)).toBe("cloud-sun");
    expect(resolveWeatherCodeIcon(3)).toBe("cloud");
    expect(resolveWeatherCodeIcon(45)).toBe("cloud-fog");
    expect(resolveWeatherCodeIcon(67)).toBe("cloud-rain");
    expect(resolveWeatherCodeIcon(85)).toBe("cloud-snow");
    expect(resolveWeatherCodeIcon(99)).toBe("cloud-lightning");
    expect(resolveWeatherCodeIcon(98)).toBeNull();
  });

  it("references local SVG assets for every registered module icon", () => {
    for (const module of CONTENT_REGISTRY) {
      expect(ICON_SOURCES[module.icon]).toMatch(/^(data:image\/svg\+xml,|.*\.svg(?:\?|$))/);
    }
    expect(ICON_SOURCES.blocks).toMatch(/^(data:image\/svg\+xml,|.*\.svg(?:\?|$))/);
  });

  it("keeps the shared mask renderer class when consumers add placement classes", () => {
    const markup = renderToStaticMarkup(createElement(LocalIcon, {
      name: "blocks",
      className: "settings-brand-icon",
    }));

    expect(markup).toContain('class="local-icon settings-brand-icon"');
  });
});
