import { LocalIcon, resolveWeatherCodeIcon } from "../../shell/LocalIcon";
import { HourlyChart } from "./HourlyChart";
import {
  describeWeatherCode,
  selectHourlyWindow,
  type WeatherReadState,
} from "./weather-model";
import type { WeatherLocationSettings } from "../../settings/settings-model";

type WeatherPreviewCardProps = {
  location: WeatherLocationSettings | null;
  state: WeatherReadState;
  formatTime: (timestampMs: number, timezone: string) => string;
};

/**
 * Compact, non-interactive weather summary for the module hover popover.
 * The popover is an aria-hidden tooltip, so this stays display-only: no
 * animation and no extremes labels (those live in the detail panel).
 */
export function WeatherPreviewCard({
  location,
  state,
  formatTime,
}: WeatherPreviewCardProps) {
  const snapshot = state.snapshot;
  if (!location || !snapshot) {
    return (
      <p className="weather-preview-empty">
        {location ? "当前没有可用天气数据" : "请在设置中填写城市名称"}
      </p>
    );
  }
  const unitSymbol = location.temperatureUnit === "celsius" ? "°C" : "°F";
  const icon = resolveWeatherCodeIcon(snapshot.current.weatherCode);
  return (
    <div className="weather-preview">
      <div className="weather-preview-head">
        <span className="weather-preview-city">{location.name}</span>
        <span className="weather-preview-temp">
          {Math.round(snapshot.current.temperature)}
          {unitSymbol}
        </span>
      </div>
      <div className="weather-preview-condition">
        {icon ? (
          <LocalIcon className="weather-preview-icon" name={icon} size={14} />
        ) : null}
        <span>{describeWeatherCode(snapshot.current.weatherCode)}</span>
      </div>
      <HourlyChart
        formatTime={formatTime}
        mode="preview"
        points={selectHourlyWindow(snapshot.hourly, snapshot.observedAtMs)}
        timezone={snapshot.providerTimezone}
        unitSymbol={unitSymbol}
      />
    </div>
  );
}
