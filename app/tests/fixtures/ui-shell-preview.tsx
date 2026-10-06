import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import { ShellFrame, type ShellModule } from "../../src/shell/ShellFrame";
import "./ui-shell-preview.css";

// This isolated fixture is the only place that supplies synthetic rings.
const fixtureModules: readonly ShellModule[] = [
  { id: "todo", label: "待办", symbol: "✓", previewLabel: "界面样例" },
  { id: "focus", label: "专注", symbol: "◷", previewLabel: "界面样例" },
  {
    id: "cpu",
    label: "CPU",
    symbol: "CPU",
    progress: 17,
    previewLabel: "示例环形状态",
  },
  {
    id: "gpu",
    label: "GPU",
    symbol: "GPU",
    progress: 36,
    previewLabel: "示例环形状态",
  },
  {
    id: "clipboard",
    label: "剪贴板",
    symbol: "▤",
    progress: 53,
    previewLabel: "示例环形状态",
  },
  {
    id: "memory",
    label: "内存",
    symbol: "▥",
    progress: 62,
    previewLabel: "示例环形状态",
  },
  { id: "media", label: "媒体", symbol: "♫", previewLabel: "界面样例" },
  { id: "weather", label: "天气", symbol: "☼", previewLabel: "界面样例" },
];

const allowedEdges = new Set(["top", "right", "bottom", "left"]);
const allowedRingModes = new Set(["off", "inner", "outer"]);
type FixtureOptions = {
  edge: "top" | "right" | "bottom" | "left";
  iconSize: number;
  ringMode: "off" | "inner" | "outer";
  longSide: number;
  thickness: number;
};

declare global {
  interface Window {
    __renderUiFixture?: (options: FixtureOptions) => void;
  }
}

const numericParam = (params: URLSearchParams, key: string, fallback: number) => {
  const value = Number(params.get(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const params = new URLSearchParams(window.location.search);
const requestedEdge = params.get("edge") ?? "top";
const requestedRingMode = params.get("ring") ?? "inner";
const root = createRoot(document.getElementById("root")!);

function renderUiFixture(options: FixtureOptions) {
  const nextParams = new URLSearchParams({
    edge: options.edge,
    icon: String(options.iconSize),
    ring: options.ringMode,
    length: String(options.longSide),
    thickness: String(options.thickness),
  });
  window.history.replaceState(null, "", `${window.location.pathname}?${nextParams}`);
  flushSync(() => {
    root.render(
    <div className="ui-shell-preview-page">
      <div aria-hidden="true" className="ui-shell-preview-header" />
      <div className="ui-shell-preview-stage">
          <ShellFrame
            key={`${options.edge}:${options.iconSize}:${options.ringMode}:${options.longSide}:${options.thickness}`}
            edge={options.edge}
            iconSize={options.iconSize}
            isFixture
            longSide={options.longSide}
            modules={fixtureModules}
            ringMode={options.ringMode}
            thickness={options.thickness}
          />
        </div>
      </div>,
    );
  });
}

window.__renderUiFixture = renderUiFixture;
renderUiFixture({
  edge: allowedEdges.has(requestedEdge)
    ? (requestedEdge as FixtureOptions["edge"])
    : "top",
  iconSize: numericParam(params, "icon", 46),
  ringMode: allowedRingModes.has(requestedRingMode)
    ? (requestedRingMode as FixtureOptions["ringMode"])
    : "inner",
  longSide: numericParam(params, "length", 580),
  thickness: numericParam(params, "thickness", 90),
});
