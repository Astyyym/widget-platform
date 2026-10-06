import { invoke } from "@tauri-apps/api/core";
import { isIanaTimezone } from "../../settings/settings-model";

export type WeatherCity = {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  label: string;
};

export async function searchWeatherCities(name: string): Promise<WeatherCity[]> {
  const query = name.trim();
  if (!query || query.length > 80) throw new Error("城市名称不能为空，且最多 80 个字符。");
  const response = await invoke<unknown>("weather_search_cities", { name: query });
  if (!Array.isArray(response) || response.length > 10) throw new Error("城市查询结果无效，请重试。");
  return response.map((value: unknown) => {
    if (typeof value !== "object" || value === null) throw new Error("城市查询结果无效，请重试。");
    const city = value as Record<string, unknown>;
    if (typeof city.name !== "string" || !city.name.trim() || city.name.length > 80 ||
        typeof city.label !== "string" || !city.label || city.label.length > 300 ||
        typeof city.latitude !== "number" || !Number.isFinite(city.latitude) || Math.abs(city.latitude) > 90 ||
        typeof city.longitude !== "number" || !Number.isFinite(city.longitude) || Math.abs(city.longitude) > 180 ||
        typeof city.timezone !== "string" || !isIanaTimezone(city.timezone)) {
      throw new Error("城市查询结果无效，请重试。");
    }
    return city as WeatherCity;
  });
}
