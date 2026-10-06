import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { searchWeatherCities } from "./weather-city";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const city = { name: "杭州", latitude: 30.27, longitude: 120.15, timezone: "Asia/Shanghai", label: "杭州 · 浙江省 · 中国" };
describe("city-only weather search", () => {
  beforeEach(() => vi.resetAllMocks());
  it("requests native lookup only for a submitted city and returns internal location", async () => {
    vi.mocked(invoke).mockResolvedValue([city]);
    expect(await searchWeatherCities(" 杭州 ")).toEqual([city]);
    expect(invoke).toHaveBeenCalledWith("weather_search_cities", { name: "杭州" });
  });
  it("rejects an empty city before IPC", async () => {
    await expect(searchWeatherCities(" ")).rejects.toThrow("城市名称");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("retains ambiguous candidates instead of silently choosing", async () => {
    vi.mocked(invoke).mockResolvedValue([city, { ...city, name: "朝阳", label: "朝阳 · 辽宁省 · 中国" }]);
    expect(await searchWeatherCities("朝阳")).toHaveLength(2);
  });
  it("rejects malformed coordinates and timezone", async () => {
    for (const invalid of [{ ...city, latitude: 91 }, { ...city, timezone: "auto" }]) {
      vi.mocked(invoke).mockResolvedValue([invalid]);
      await expect(searchWeatherCities("杭州")).rejects.toThrow();
    }
  });
  it("returns no candidates without fake coordinates", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    expect(await searchWeatherCities("不存在的城市")).toEqual([]);
  });
});
