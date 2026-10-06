import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ShellFrame } from "./ShellFrame";

describe("navigation appearance ownership", () => {
  it("keeps transparency out of the navigation bar while retaining modules and settings", () => {
    const markup = renderToStaticMarkup(createElement(ShellFrame, { isFixture: true }));
    expect(markup).not.toContain("调整导航条透明度");
    expect(markup).not.toContain("data-dock-opacity");
    expect(markup).toContain('aria-label="打开停靠设置"');
    expect(markup).toContain('data-module-id="focus"');
    expect(markup).toContain('data-material="solid"');
  });

  it("keeps the compact geometry variables and uses a lighter single shadow", () => {
    const markup = renderToStaticMarkup(createElement(ShellFrame, { isFixture: true }));
    const css = readFileSync(new URL("./shell-frame.css", import.meta.url), "utf8");
    expect(markup).toContain("--shell-strip-length");
    expect(markup).toContain("--shell-strip-thickness");
    expect(css).toContain("backdrop-filter: blur(var(--shell-dock-blur, 16px))");
    expect(css).toContain("--shell-dock-shadow: 0 8px 18px rgba(0, 0, 0, 0.1)");
  });
});
