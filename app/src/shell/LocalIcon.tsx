import type { CSSProperties } from "react";
import arrowDown from "../assets/icons/arrow-down.svg?url";
import arrowLeft from "../assets/icons/arrow-left.svg?url";
import arrowUp from "../assets/icons/arrow-up.svg?url";
import bellRing from "../assets/icons/bell-ring.svg?url";
import blocks from "../assets/icons/blocks.svg?url";
import check from "../assets/icons/check.svg?url";
import clipboardList from "../assets/icons/clipboard-list.svg?url";
import clock from "../assets/icons/clock.svg?url";
import cloud from "../assets/icons/cloud.svg?url";
import cloudFog from "../assets/icons/cloud-fog.svg?url";
import cloudLightning from "../assets/icons/cloud-lightning.svg?url";
import cloudOff from "../assets/icons/cloud-off.svg?url";
import cloudRain from "../assets/icons/cloud-rain.svg?url";
import cloudSnow from "../assets/icons/cloud-snow.svg?url";
import cloudSun from "../assets/icons/cloud-sun.svg?url";
import cpu from "../assets/icons/cpu.svg?url";
import circle from "../assets/icons/circle.svg?url";
import gpu from "../assets/icons/gpu.svg?url";
import gripVertical from "../assets/icons/grip-vertical.svg?url";
import hand from "../assets/icons/hand.svg?url";
import listChecks from "../assets/icons/list-checks.svg?url";
import memoryStick from "../assets/icons/memory-stick.svg?url";
import move from "../assets/icons/move.svg?url";
import music from "../assets/icons/music.svg?url";
import palette from "../assets/icons/palette.svg?url";
import pause from "../assets/icons/pause.svg?url";
import play from "../assets/icons/play.svg?url";
import settings from "../assets/icons/settings.svg?url";
import skipBack from "../assets/icons/skip-back.svg?url";
import skipForward from "../assets/icons/skip-forward.svg?url";
import squareTerminal from "../assets/icons/square-terminal.svg?url";
import sun from "../assets/icons/sun.svg?url";
import timer from "../assets/icons/timer.svg?url";
import trash2 from "../assets/icons/trash-2.svg?url";
import x from "../assets/icons/x.svg?url";

export const ICON_SOURCES = {
  "arrow-down": arrowDown,
  "arrow-left": arrowLeft,
  "arrow-up": arrowUp,
  "bell-ring": bellRing,
  blocks,
  check,
  "clipboard-list": clipboardList,
  clock,
  cloud,
  "cloud-fog": cloudFog,
  "cloud-lightning": cloudLightning,
  "cloud-off": cloudOff,
  "cloud-rain": cloudRain,
  "cloud-snow": cloudSnow,
  "cloud-sun": cloudSun,
  cpu,
  circle,
  gpu,
  "grip-vertical": gripVertical,
  hand,
  "list-checks": listChecks,
  "memory-stick": memoryStick,
  move,
  music,
  palette,
  pause,
  play,
  settings,
  "skip-back": skipBack,
  "skip-forward": skipForward,
  "square-terminal": squareTerminal,
  sun,
  timer,
  "trash-2": trash2,
  x,
} as const;

export type IconName = keyof typeof ICON_SOURCES;

type LocalIconProps = {
  name: IconName;
  className?: string;
  size?: number;
};

export function LocalIcon({ name, className, size }: LocalIconProps) {
  const style = {
    "--local-icon-source": `url("${ICON_SOURCES[name]}")`,
    ...(size === undefined ? {} : { width: `${size}px`, height: `${size}px` }),
  } as CSSProperties;

  const iconClassName = className ? `local-icon ${className}` : "local-icon";
  return <span aria-hidden="true" className={iconClassName} style={style} />;
}

export function resolveSummaryIcon(
  moduleId: string,
  symbol: string,
  symbolVariant?: "readout",
): IconName | null {
  if (symbolVariant === "readout") return null;
  switch (moduleId) {
    case "todo": return symbol === "✓" ? "check" : "circle";
    case "focus":
      return symbol === "🔔" ? "bell-ring" : symbol === "⌛" ? "timer" : "clock";
    case "cpu": return "cpu";
    case "gpu": return "gpu";
    case "memory": return "memory-stick";
    case "media": return symbol === "Ⅱ" ? "pause" : symbol === "▶" ? "play" : "music";
    case "codex": return "square-terminal";
    case "weather": return resolveWeatherIcon(symbol);
    case "clipboard": return "clipboard-list";
    default: return null;
  }
}

export function resolveWeatherIcon(symbol: string): IconName | null {
  if (symbol === "cloud-off") return "cloud-off";
  switch (symbol) {
    case "☀": return "sun";
    case "☼": return "sun";
    case "☁": return "cloud-sun";
    case "≋": return "cloud-fog";
    case "☂": return "cloud-rain";
    case "❄": return "cloud-snow";
    case "ϟ": return "cloud-lightning";
    default: return null;
  }
}

export function resolveWeatherCodeIcon(code: number): IconName | null {
  if (code === 0) return "sun";
  if (code === 1 || code === 2) return "cloud-sun";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "cloud-fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "cloud-rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "cloud-snow";
  if (code === 95 || code === 96 || code === 99) return "cloud-lightning";
  return null;
}
