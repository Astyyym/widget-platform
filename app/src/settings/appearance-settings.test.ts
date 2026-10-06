import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
import { DEFAULT_WIDGET_SETTINGS } from "./settings-model";
import { calculateShellLayout } from "../shell/shell-layout";

function renderAppearance(material: "solid" | "translucent" | "glass") {
  return renderToStaticMarkup(createElement(SettingsPanel, {
    initialTab: "appearance",
    settings: { ...DEFAULT_WIDGET_SETTINGS, dockMaterial: material },
    layout: calculateShellLayout({ stageWidth: 440, stageHeight: 520, edge: "top", itemCount: 5, iconSize: 46, ringMode: "off" }),
    notice: null,
    saveState: "idle",
    saveFailure: null,
    closeButtonRef: { current: null },
    onChange: vi.fn(async () => true),
    onClose: vi.fn(),
  }));
}

describe("appearance settings", () => {
  it("shows only the controls applicable to each material", () => {
    const solid = renderAppearance("solid");
    const translucent = renderAppearance("translucent");
    const glass = renderAppearance("glass");

    for (const markup of [solid, translucent, glass]) {
      expect(markup).toContain("背景材质");
      expect(markup).toContain("普通背景");
      expect(markup).toContain("半透明");
      expect(markup).toContain("模糊玻璃");
    }
    expect(solid).not.toContain('id="settings-dock-opacity"');
    expect(solid).not.toContain('id="settings-dock-blur"');
    expect(translucent).toContain('id="settings-dock-opacity"');
    expect(translucent).not.toContain('id="settings-dock-blur"');
    expect(glass).not.toContain('id="settings-dock-opacity"');
    expect(glass).toContain('id="settings-dock-blur"');
  });
});