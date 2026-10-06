import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalIcon } from "../../shell/LocalIcon";
import { TimerPanel } from "./TimerPanel";

function renderPanel(isFixture: boolean): string {
  return renderToStaticMarkup(createElement(TimerPanel, {
    closeButtonRef: createRef<HTMLButtonElement>(),
    onClose: () => undefined,
    isFixture,
  }));
}

describe("Timer panel local icons", () => {
  it.each([false, true])("uses the accessible return icon in fixture=%s", (isFixture) => {
    const markup = renderPanel(isFixture);
    const header = markup.match(/<header>[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(header).toContain('aria-label="关闭详情"');
    expect(header).toContain('class="shell-panel-close"');
    expect(header).toContain(renderToStaticMarkup(createElement(LocalIcon, {
      name: "x", size: 16,
    })));
    expect(header).not.toContain("×");
  });

  it("preserves the real panel text controls and duration input", () => {
    const markup = renderPanel(false);
    for (const label of ["开始", "重置", "专注", "休息"])
      expect(markup).toMatch(new RegExp(`>${label}</button>`));
    expect(markup).not.toMatch(/>继续<\/button>/);
    expect(markup).toContain('aria-label="计时分钟数"');
    expect(markup).toContain('min="1" max="10080"');
    expect(markup).toContain('value="25"');
    expect(markup).toContain("待开始");
    expect(markup).toContain("正在同步");
  });

  it("keeps exactly two action buttons in the idle state", () => {
    expect(renderPanel(false)).toContain("待开始");
    expect(renderPanel(false).match(/class=\"timer-actions\"[\s\S]*?<\/div>/)?.[0].match(/<button/g)).toHaveLength(2);
  });

  it("renders a used-time progress bar and only two state actions", () => {
    const markup = renderToStaticMarkup(createElement(TimerPanel, {
      closeButtonRef: createRef<HTMLButtonElement>(), onClose: () => undefined, isFixture: true,
    }));
    expect(markup).toContain('aria-label="计时已用进度"');
    expect(markup).toContain("progress-bar");
    expect(markup.match(/<button/g)?.length).toBe(1);
  });
});
