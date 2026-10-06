import { useId } from "react";
import { LocalIcon, resolveWeatherCodeIcon } from "../../shell/LocalIcon";
import { describeWeatherCode, type WeatherPoint } from "./weather-model";
import "./weather-hourly-chart.css";

type HourlyChartMode = "preview" | "detail";

type HourlyChartProps = {
  points: readonly WeatherPoint[];
  unitSymbol: string;
  timezone: string;
  mode: HourlyChartMode;
  /** Formats an hourly point's timestamp into a short axis label (e.g. "14:00"). */
  formatTime: (timestampMs: number, timezone: string) => string;
};

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 96;
const PAD_X = 10;
const PAD_TOP = 18;
const PAD_BOTTOM = 14;

type PlottedPoint = {
  point: WeatherPoint;
  x: number;
  y: number;
  label: string;
};

function plotPoints(
  points: readonly WeatherPoint[],
  formatTime: HourlyChartProps["formatTime"],
  timezone: string,
): { plotted: PlottedPoint[]; minTemp: number; maxTemp: number } {
  const temperatures = points.map((point) => point.temperature);
  const minTemp = Math.min(...temperatures);
  const maxTemp = Math.max(...temperatures);
  const span = maxTemp - minTemp;
  const usableWidth = VIEW_WIDTH - PAD_X * 2;
  const usableHeight = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const step = points.length > 1 ? usableWidth / (points.length - 1) : 0;

  const plotted = points.map((point, index) => {
    // Flat series (span === 0) sits on the vertical middle so it stays visible.
    const ratio = span === 0 ? 0.5 : (point.temperature - minTemp) / span;
    return {
      point,
      x: PAD_X + step * index,
      y: PAD_TOP + (1 - ratio) * usableHeight,
      label: formatTime(point.atMs, timezone),
    };
  });
  return { plotted, minTemp, maxTemp };
}

function polylinePath(plotted: readonly PlottedPoint[]): string {
  return plotted
    .map((entry, index) => `${index === 0 ? "M" : "L"}${entry.x.toFixed(2)} ${entry.y.toFixed(2)}`)
    .join(" ");
}

/** Indices of the highest and lowest temperature points, first occurrence wins. */
function extremeIndices(plotted: readonly PlottedPoint[]): { high: number; low: number } {
  let high = 0;
  let low = 0;
  plotted.forEach((entry, index) => {
    if (entry.point.temperature > plotted[high].point.temperature) high = index;
    if (entry.point.temperature < plotted[low].point.temperature) low = index;
  });
  return { high, low };
}

export function HourlyChart({
  points,
  unitSymbol,
  timezone,
  mode,
  formatTime,
}: HourlyChartProps) {
  const gradientId = useId();
  if (points.length === 0) return null;

  const { plotted } = plotPoints(points, formatTime, timezone);
  const path = polylinePath(plotted);
  const { high, low } = extremeIndices(plotted);
  const isDetail = mode === "detail";

  return (
    <div className="weather-chart" data-mode={mode}>
      <svg
        aria-hidden="true"
        className="weather-chart-svg"
        preserveAspectRatio="none"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--shell-accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--shell-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          className="weather-chart-area"
          d={`${path} L${plotted[plotted.length - 1].x.toFixed(2)} ${VIEW_HEIGHT - PAD_BOTTOM} L${plotted[0].x.toFixed(2)} ${VIEW_HEIGHT - PAD_BOTTOM} Z`}
          fill={`url(#${gradientId})`}
        />
        <path className="weather-chart-line" d={path} />
        {plotted.map((entry, index) => (
          <circle
            className="weather-chart-dot"
            cx={entry.x}
            cy={entry.y}
            key={entry.point.atMs}
            r={isDetail && (index === high || index === low) ? 3.2 : 2.2}
          />
        ))}
      </svg>

      {isDetail ? (
        <div className="weather-chart-extremes" aria-hidden="true">
          <span className="weather-chart-extreme is-high" style={{ left: `${(plotted[high].x / VIEW_WIDTH) * 100}%` }}>
            {Math.round(plotted[high].point.temperature)}
            {unitSymbol}
          </span>
          <span className="weather-chart-extreme is-low" style={{ left: `${(plotted[low].x / VIEW_WIDTH) * 100}%` }}>
            {Math.round(plotted[low].point.temperature)}
            {unitSymbol}
          </span>
        </div>
      ) : null}

      {isDetail ? (
        <ul className="weather-chart-band" aria-label="逐小时天气">
          {plotted.map((entry, index) => {
            // Show every other point so labels never crowd the axis; hidden
            // points still appear as dots on the line above.
            if (index % 2 !== 0) return null;
            const icon = resolveWeatherCodeIcon(entry.point.weatherCode);
            return (
              <li
                className="weather-chart-band-item"
                key={entry.point.atMs}
                style={{ left: `${(entry.x / VIEW_WIDTH) * 100}%` }}
              >
                <span className="weather-chart-band-time">{entry.label}</span>
                {icon ? (
                  <LocalIcon className="weather-chart-band-icon" name={icon} size={14} />
                ) : (
                  <span aria-hidden="true" className="weather-chart-band-icon weather-chart-band-icon-fallback">?</span>
                )}
                <span className="weather-chart-band-text">{describeWeatherCode(entry.point.weatherCode)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
