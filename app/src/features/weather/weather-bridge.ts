import { invoke } from "@tauri-apps/api/core";
import type { WeatherLocationSettings } from "../../settings/settings-model";

export interface WeatherBridge {
  read(location: WeatherLocationSettings): Promise<unknown>;
  cancel(location: WeatherLocationSettings): Promise<boolean>;
}

export const weatherBridge: WeatherBridge = {
  read: (location) => invoke<unknown>("weather_read", { location }),
  cancel: (location) => invoke<boolean>("weather_cancel", { location }),
};
