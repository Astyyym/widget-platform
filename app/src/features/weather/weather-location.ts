import { invoke } from "@tauri-apps/api/core";
import type { WeatherLocationSettings } from "../../settings/settings-model";

export function locateWeather(temperatureUnit: WeatherLocationSettings["temperatureUnit"]): Promise<WeatherLocationSettings> {
  return invoke<WeatherLocationSettings>("weather_locate", { unit: temperatureUnit });
}