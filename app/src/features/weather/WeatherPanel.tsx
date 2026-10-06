import type { Ref } from "react";
import { LocalIcon } from "../../shell/LocalIcon";
import type { WeatherLocationSettings } from "../../settings/settings-model";
import { HourlyChart } from "./HourlyChart";
import {
  describeWeatherCode,
  formatWeatherTime,
  selectHourlyWindow,
  type WeatherReadState,
} from "./weather-model";
import "./weather-panel.css";

type WeatherPanelProps = {
  location: WeatherLocationSettings | null;
  state: WeatherReadState;
  isRefreshing: boolean;
  closeButtonRef: Ref<HTMLButtonElement>;
  onClose: () => void;
};

function formatTemperature(value: number, unit: WeatherLocationSettings["temperatureUnit"]): string {
  return `${Math.round(value)}${unit === "celsius" ? "°C" : "°F"}`;
}

function formatObservedTime(timestampMs: number | null, timezone: string | null): string {
  if (timestampMs === null || timezone === null) return "尚无更新时间";
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return "更新时间不可用";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return "更新时间不可用";
  }
}

export function WeatherPanel({
  location,
  state,
  isRefreshing,
  closeButtonRef,
  onClose,
}: WeatherPanelProps) {
  const snapshot = state.snapshot;
  const timezone = snapshot?.providerTimezone ?? location?.timezone ?? null;
  const status = !location
    ? "尚未配置城市"
    : isRefreshing && !snapshot
      ? "正在读取天气"
      : state.quality === "stale"
        ? "本次更新失败，显示上次成功数据"
        : snapshot
          ? "天气已更新"
          : "当前没有可用天气数据";

  return (
    <>
      <header>
        <div>
          <span>Open-Meteo · 只读天气</span>
          <h1>{location?.name ?? "天气"}</h1>
        </div>
        <button
          aria-label="关闭详情"
          className="shell-panel-close"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          <LocalIcon name="x" size={16} />
        </button>
      </header>

      <p
        aria-busy={isRefreshing || undefined}
        className="weather-status"
        data-quality={state.quality}
        role="status"
      >
        {status}
      </p>

      {!location ? (
        <p className="weather-empty">请在设置的“服务配置”中填写城市名称并选择温度单位；应用不会自动定位。</p>
      ) : snapshot ? (
        <>
          <section className="weather-current" aria-label="当前天气">
            <div>
              <strong>{formatTemperature(snapshot.current.temperature, location.temperatureUnit)}</strong>
              <span>{describeWeatherCode(snapshot.current.weatherCode)}</span>
            </div>
            <dl>
              <div><dt>最高</dt><dd>{formatTemperature(snapshot.daily.highTemperature, location.temperatureUnit)}</dd></div>
              <div><dt>最低</dt><dd>{formatTemperature(snapshot.daily.lowTemperature, location.temperatureUnit)}</dd></div>
            </dl>
          </section>
          <section className="weather-hourly" aria-label="小时预报">
            <h2>小时预报</h2>
            <HourlyChart
              formatTime={formatWeatherTime}
              mode="detail"
              points={selectHourlyWindow(snapshot.hourly, snapshot.observedAtMs)}
              timezone={snapshot.providerTimezone}
              unitSymbol={location.temperatureUnit === "celsius" ? "°C" : "°F"}
            />
          </section>
        </>
      ) : (
        <p className="weather-empty">联网失败时会保留同一城市的上次成功数据；当前尚无可显示缓存。</p>
      )}

      <footer className="weather-footer">
        <span aria-hidden="true" />
        来源：Open-Meteo · {formatObservedTime(snapshot?.observedAtMs ?? null, timezone)}
      </footer>
    </>
  );
}
