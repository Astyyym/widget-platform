import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../../src/shell/shell-frame.css";
import { ICON_SOURCES } from "../../src/shell/LocalIcon";
import { WeatherPanel } from "../../src/features/weather/WeatherPanel";
import { INITIAL_WEATHER_STATE, type WeatherReadState, type WeatherSnapshot } from "../../src/features/weather/weather-model";
import type { WeatherLocationSettings } from "../../src/settings/settings-model";

// E1 only: synthetic props; no Store, bridge, Shell, IPC, network or location reads.
const observedAtMs = Date.UTC(2026, 8, 30, 0, 0);
const location: WeatherLocationSettings = { name: "合成测试城市", latitude: 0, longitude: 0, timezone: "Etc/UTC", temperatureUnit: "celsius" };
const snapshot: WeatherSnapshot = {
  schemaVersion: 1, source: "Open-Meteo", location, providerTimezone: "Etc/UTC", observedAtMs,
  current: { temperature: 23, weatherCode: 0 }, daily: { highTemperature: 26, lowTemperature: 18, weatherCode: 0 },
  hourly: Array.from({ length: 13 }, (_, index) => ({ atMs: observedAtMs + index * 3_600_000, temperature: 20 + index, weatherCode: [0, 2, 3, 45, 51, 61, 65, 71, 75, 95, 999, 48, 86][index]! })),
};
type Scenario = "fresh" | "stale" | "unavailable" | "unconfigured" | "loading" | "refreshing" | "unknown" | "fahrenheit";
let scenario: Scenario = "fresh", closed = false;
const root = createRoot(document.getElementById("root")!);
const closeButtonRef = createRef<HTMLButtonElement>();
function getLocation() { return scenario === "unconfigured" ? null : { ...location, temperatureUnit: scenario === "fahrenheit" ? "fahrenheit" as const : "celsius" as const }; }
function getState(): WeatherReadState {
  if (["unconfigured", "loading"].includes(scenario)) return INITIAL_WEATHER_STATE;
  if (scenario === "unavailable") return { ...INITIAL_WEATHER_STATE, failureReason: "network", lastAttemptAtMs: observedAtMs + 60_000 };
  const data = { ...snapshot, location: getLocation()!, current: { temperature: scenario === "fahrenheit" ? 73 : 23, weatherCode: scenario === "unknown" ? 999 : 0 } };
  return { ...INITIAL_WEATHER_STATE, snapshot: data, quality: scenario === "stale" ? "stale" : "fresh", failureReason: scenario === "stale" ? "network" : null, lastAttemptAtMs: scenario === "stale" ? observedAtMs + 60_000 : observedAtMs };
}
function close() { closed = true; render(); }
function render() {
  flushSync(() => root.render(<div className="shell-stage" style={{ minHeight: "100vh" }}>
    <button id="fixture-focus-start" type="button" style={{ position: "absolute", left: 16, top: 8 }}>合成摘要入口</button>
    {closed ? <p>已返回摘要</p> : <section aria-label="合成天气面板" className="shell-activity-panel edge-top" style={{ top: 60 }}>
      <WeatherPanel location={getLocation()} state={getState()} isRefreshing={scenario === "loading" || scenario === "refreshing"} closeButtonRef={closeButtonRef} onClose={close} />
    </section>}
  </div>));
}
declare global { interface Window {
  __resetWeatherIcons: (value: Scenario) => void;
  __weatherIconState: () => { scenario: Scenario; closed: boolean; state: WeatherReadState; observedTime: string; attemptTime: string };
  __weatherIconSources: typeof ICON_SOURCES;
} }
const formatTime = (timestamp: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Etc/UTC", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
window.__resetWeatherIcons = value => { scenario = value; closed = false; render(); };
window.__weatherIconState = () => ({ scenario, closed, state: getState(), observedTime: formatTime(observedAtMs), attemptTime: formatTime(observedAtMs + 60_000) });
window.__weatherIconSources = ICON_SOURCES;
render();
