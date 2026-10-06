import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SETTINGS_WINDOW_DEFAULT_SIZE } from "./settings-window";

const settingsCss = readFileSync(fileURLToPath(new URL("./settings.css", import.meta.url)), "utf8");
const shellFrameCss = readFileSync(
  fileURLToPath(new URL("../shell/shell-frame.css", import.meta.url)),
  "utf8",
);
const settingsPanelSource = readFileSync(fileURLToPath(new URL("./SettingsPanel.tsx", import.meta.url)), "utf8");

describe("settings native window bounds", () => {
  it("starts at the content-sized default instead of a transparent oversized canvas", () => {
    expect(SETTINGS_WINDOW_DEFAULT_SIZE).toEqual({ width: 620, height: 520 });
  });

  it("fills the native window edge-to-edge with no content cap", () => {
    // The settings panel must equal the real window bounds so the visible edge is the
    // grabbable edge; a 6px inset left the resize handles floating inside the window.
    const panelRule =
      shellFrameCss.match(/\.shell-settings-panel\.settings-window\s*\{([^}]*)\}/s)?.[1] ?? "";

    expect(panelRule).toMatch(/width:\s*100%/);
    expect(panelRule).toMatch(/height:\s*100%/);
    expect(panelRule).toMatch(/max-width:\s*none/);
    expect(panelRule).toMatch(/max-height:\s*none/);
    expect(panelRule).not.toMatch(/calc\(100%\s*-\s*12px\)/);
    expect(panelRule).not.toMatch(/max-width:\s*620px/);
    expect(panelRule).not.toMatch(/max-height:\s*700px/);
  });

  it("anchors resize handles to the true window edge, outside the clipped panel", () => {
    const hitRegionRule = settingsCss.match(/\.settings-window-resize\s*\{([^}]*)\}/s)?.[1] ?? "";

    // fixed positioning escapes the panel's overflow:hidden + border-radius clip so the
    // visible rounded corner is always grabbable.
    expect(hitRegionRule).toMatch(/position:\s*fixed/);
    expect(hitRegionRule).toMatch(/z-index:\s*40/);
    expect(settingsCss).toContain("touch-action: none");
    expect(settingsCss).toContain("user-select: none");
  });

  it("sizes the corner handle to cover the 16px rounded corner", () => {
    const cornerRule =
      settingsCss.match(/\.settings-window-resize\.resize-south-west,\s*\.settings-window-resize\.resize-south-east\s*\{([^}]*)\}/s)?.[1] ?? "";

    const width = Number(cornerRule.match(/width:\s*(\d+)px/)?.[1] ?? "0");
    const height = Number(cornerRule.match(/height:\s*(\d+)px/)?.[1] ?? "0");
    expect(width).toBeGreaterThanOrEqual(16);
    expect(height).toBeGreaterThanOrEqual(16);
  });

  it("keeps the resize corner out of the window-drag event chain", () => {
    const southEastHandler = settingsPanelSource.match(/resize-south-east[\s\S]*?onPointerDown=\{\(event\) => \{([\s\S]*?)\}\} \/>/)?.[1] ?? "";

    expect(southEastHandler).toContain("event.stopPropagation()");
    expect(southEastHandler).toContain('windowFrame.onResizeStart("SouthEast")');
  });

});