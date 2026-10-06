import type { WeatherLocationSettings } from "../../settings/settings-model";
import type { WeatherBridge } from "./weather-bridge";
import {
  INITIAL_WEATHER_STATE,
  parseWeatherReadState,
  type WeatherReadState,
} from "./weather-model";

export const WEATHER_REFRESH_INTERVAL_MS = 30 * 60_000;
const WEATHER_FAILURE_RETRY_MS = 5 * 60_000;
const WEATHER_BUSY_RETRY_MS = 250;
const MAX_TIMEOUT_MS = 2_147_483_647;

export type WeatherStoreState = {
  weather: WeatherReadState;
  isRefreshing: boolean;
};

export type WeatherVisibility = {
  isFixture: boolean;
  documentVisible: boolean;
  moduleEnabled: boolean;
  hidden: boolean;
  settingsOpen: boolean;
  location: WeatherLocationSettings | null;
};

type Connection = {
  bridge: WeatherBridge;
  location: WeatherLocationSettings;
  consumers: number;
  timer: ReturnType<typeof setTimeout> | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
  pending: boolean;
  generation: number;
};

type Subscriber = () => void;
type Unsubscribe = () => void;

export function shouldConnectWeather(visibility: WeatherVisibility): boolean {
  return (
    !visibility.isFixture &&
    visibility.documentVisible &&
    visibility.moduleEnabled &&
    !visibility.settingsOpen &&
    visibility.location !== null
  );
}

function sameLocation(a: WeatherLocationSettings, b: WeatherLocationSettings): boolean {
  return (
    a.name === b.name &&
    a.latitude === b.latitude &&
    a.longitude === b.longitude &&
    a.timezone === b.timezone &&
    a.temperatureUnit === b.temperatureUnit
  );
}

function bridgeErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

export class WeatherSnapshotStore {
  private state: WeatherStoreState = {
    weather: INITIAL_WEATHER_STATE,
    isRefreshing: false,
  };
  private readonly subscribers = new Set<Subscriber>();
  private connection: Connection | null = null;

  readonly getState = (): WeatherStoreState => this.state;

  readonly subscribe = (subscriber: Subscriber): Unsubscribe => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  connect(bridge: WeatherBridge, location: WeatherLocationSettings): Unsubscribe {
    let connection = this.connection;
    if (connection && !sameLocation(connection.location, location)) {
      this.stopConnection(connection, true);
      connection = null;
      this.replaceState({ weather: INITIAL_WEATHER_STATE, isRefreshing: false });
    }
    if (!connection) {
      connection = {
        bridge,
        location,
        consumers: 0,
        timer: null,
        stopTimer: null,
        pending: false,
        generation: 0,
      };
      this.connection = connection;
    }
    if (connection.stopTimer !== null) {
      clearTimeout(connection.stopTimer);
      connection.stopTimer = null;
    }
    connection.consumers += 1;
    if (connection.consumers === 1) void this.refresh(connection);

    let disconnected = false;
    return () => {
      if (disconnected) return;
      disconnected = true;
      if (this.connection !== connection) return;
      connection.consumers = Math.max(0, connection.consumers - 1);
      if (connection.consumers === 0) {
        if (connection.timer !== null) clearTimeout(connection.timer);
        connection.timer = null;
        connection.stopTimer = setTimeout(() => this.stopConnection(connection), 0);
      }
    };
  }

  private stopConnection(connection: Connection, force = false): void {
    connection.stopTimer = null;
    if (this.connection !== connection || (!force && connection.consumers > 0)) return;
    connection.consumers = 0;
    if (connection.timer !== null) clearTimeout(connection.timer);
    connection.timer = null;
    this.connection = null;
    if (connection.pending) {
      connection.generation += 1;
      void connection.bridge.cancel(connection.location).catch(() => undefined);
    }
    this.replaceState({ weather: this.state.weather, isRefreshing: false });
  }

  private async refresh(connection: Connection): Promise<void> {
    if (
      this.connection !== connection ||
      connection.consumers === 0 ||
      connection.pending
    ) return;

    connection.pending = true;
    const generation = ++connection.generation;
    this.replaceState({ weather: this.state.weather, isRefreshing: true });
    let delay = WEATHER_FAILURE_RETRY_MS;
    try {
      const weather = parseWeatherReadState(
        await connection.bridge.read(connection.location),
      );
      if (!this.isCurrent(connection, generation)) return;
      if (weather.failureReason === "cancelled") {
        delay = WEATHER_BUSY_RETRY_MS;
        this.replaceState({ weather: this.state.weather, isRefreshing: false });
        return;
      }
      delay = weather.quality === "fresh"
        ? Math.max(WEATHER_REFRESH_INTERVAL_MS, weather.retryAfterMs)
        : Math.max(1_000, weather.retryAfterMs);
      this.replaceState({ weather, isRefreshing: false });
    } catch (error) {
      if (!this.isCurrent(connection, generation)) return;
      if (["refreshInProgress", "cancelled"].includes(bridgeErrorCode(error) ?? "")) {
        delay = WEATHER_BUSY_RETRY_MS;
        this.replaceState({ weather: this.state.weather, isRefreshing: false });
        return;
      }
      const attemptedAtMs = Date.now();
      this.replaceState({
        weather: this.state.weather.snapshot
          ? {
              ...this.state.weather,
              quality: "stale",
              failureReason: "transport",
              retryAfterMs: WEATHER_FAILURE_RETRY_MS,
              lastAttemptAtMs: attemptedAtMs,
            }
          : {
              ...INITIAL_WEATHER_STATE,
              failureReason: "transport",
              retryAfterMs: WEATHER_FAILURE_RETRY_MS,
              lastAttemptAtMs: attemptedAtMs,
            },
        isRefreshing: false,
      });
    } finally {
      connection.pending = false;
      if (!this.isCurrent(connection, generation) || connection.consumers === 0) return;
      connection.timer = setTimeout(() => {
        connection.timer = null;
        void this.refresh(connection);
      }, Math.min(delay, MAX_TIMEOUT_MS));
    }
  }

  private isCurrent(connection: Connection, generation: number): boolean {
    return this.connection === connection && connection.generation === generation;
  }

  private replaceState(state: WeatherStoreState): void {
    this.state = state;
    for (const subscriber of this.subscribers) subscriber();
  }
}
