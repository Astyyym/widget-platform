import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  CONTENT_REGISTRY,

  SETTING_LIMITS,
  type ContentId,
  type TemperatureUnit,
  type WeatherLocationSettings,
  type WidgetSettings,
} from "./settings-model";
import type { ShellLayout } from "../shell/shell-layout";
import { LocalIcon, type IconName } from "../shell/LocalIcon";
import { searchWeatherCities, type WeatherCity } from "../features/weather/weather-city";
import { locateWeather } from "../features/weather/weather-location";
import "./settings.css";

type SettingsTab = "modules" | "services" | "appearance" | "behavior";
type SaveState = "idle" | "saving" | "saved" | "failed";
type WeatherDraft = {
  name: string;

  temperatureUnit: TemperatureUnit;
};

type SettingsPanelProps = {
  settings: WidgetSettings;
  layout: ShellLayout;
  initialTab?: SettingsTab;
  notice: string | null;
  saveState: SaveState;
  saveFailure: string | null;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onChange: (settings: WidgetSettings) => Promise<boolean>;
  onClose: () => void;
  windowFrame?: {
    onClose: () => void;
    onMinimize: () => void;
    onDragStart: () => void;
    onResizeStart: (direction: "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest") => void;
  };
};

const TABS: ReadonlyArray<{
  id: SettingsTab;
  icon: IconName;
  label: string;
  subtitle: string;
}> = [
  {
    id: "modules",
    icon: "list-checks",
    label: "模块与顺序",
    subtitle: "选择要显示的圆形图标，并调整它们在摘要栏中的顺序。",
  },
  {
    id: "services",
    icon: "sun",
    label: "服务配置",
    subtitle: "填写天气城市与单位，或主动设为当前位置。",
  },
  {
    id: "appearance",
    icon: "palette",
    label: "外观",
    subtitle: "调整显示方式、卡片尺寸与独立图标大小。",
  },
  {
    id: "behavior",
    icon: "move",
    label: "位置与交互",
    subtitle: "选择四边中心停靠，并管理隐藏后的唤回入口。",
  },
];

const EDGE_OPTIONS = [
  { id: "left", label: "左侧" },
  { id: "right", label: "右侧" },
  { id: "top", label: "顶部" },
  { id: "bottom", label: "底部" },
] as const;

const BACKGROUND_MATERIALS = [
  { id: "solid", label: "普通背景" },
  { id: "translucent", label: "半透明" },
  { id: "glass", label: "模糊玻璃" },
] as const;

function moveContentId(ids: ContentId[], index: number, direction: -1 | 1): ContentId[] {
  const target = index + direction;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function numberFromInput(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function weatherDraftFromSettings(weather: WeatherLocationSettings | null): WeatherDraft {
  return weather
    ? {
        name: weather.name,

        temperatureUnit: weather.temperatureUnit,
      }
    : {
        name: "",

        temperatureUnit: "celsius",
      };
}

export function SettingsPanel({
  settings,
  layout,
  initialTab,
  notice,
  saveState,
  saveFailure,
  closeButtonRef,
  onChange,
  onClose,
  windowFrame,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? "modules");
  const [weatherDraft, setWeatherDraft] = useState<WeatherDraft>(() =>
    weatherDraftFromSettings(settings.weather),
  );
  const [weatherDraftError, setWeatherDraftError] = useState<string | null>(null);
  const [weatherCities, setWeatherCities] = useState<WeatherCity[]>([]);
  const [weatherSearching, setWeatherSearching] = useState(false);
  const [weatherLocating, setWeatherLocating] = useState(false);
  const weatherSearchRevision = useRef(0);
  const weatherSearchPending = useRef(false);
  useEffect(() => () => { weatherSearchRevision.current++; }, []);
  const activeTabInfo = TABS.find(({ id }) => id === activeTab) ?? TABS[0];
  const activeIds = settings.enabledContentIds;
  const availableModules = CONTENT_REGISTRY.filter(({ id }) => !activeIds.includes(id));

  const change = (patch: Partial<WidgetSettings>) =>
    onChange({ ...settings, ...patch });

  const setVisibility = async (visibility: WidgetSettings["visibility"]) => {
    if (visibility === settings.visibility) return;
    await change({ visibility });
  };

  const saveWeather = async () => {
    const name = weatherDraft.name.trim();
    if (!name || name.length > 80) {
      setWeatherDraftError("城市名称不能为空，且最多 80 个字符。");
      return;
    }
    if (weatherSearchPending.current) return;
    if (settings.weather?.name === name) {
      await saveWeatherCity(settings.weather);
      return;
    }
    const revision = ++weatherSearchRevision.current;
    weatherSearchPending.current = true;
    setWeatherSearching(true);
    setWeatherDraftError(null);
    setWeatherCities([]);
    try {
      const cities = await searchWeatherCities(name);
      if (revision !== weatherSearchRevision.current) return;
      if (cities.length === 0) setWeatherDraftError("没有找到该城市，请检查名称，或补充省份/国家。");
      else if (cities.length === 1) await saveWeatherCity(cities[0]);
      else setWeatherCities(cities);
    } catch {
      if (revision === weatherSearchRevision.current) setWeatherDraftError("城市查询失败，请检查网络后重试；原配置已保留。");
    } finally {
      weatherSearchPending.current = false;
      if (revision === weatherSearchRevision.current) setWeatherSearching(false);
    }
  };

  const saveWeatherCity = async (city: Pick<WeatherLocationSettings, "name" | "latitude" | "longitude" | "timezone">) => {
    const saved = await change({ weather: { name: city.name, latitude: city.latitude, longitude: city.longitude, timezone: city.timezone, temperatureUnit: weatherDraft.temperatureUnit } });
    if (saved) {
      setWeatherDraft((current) => ({ ...current, name: city.name }));
      setWeatherCities([]);
      setWeatherDraftError(null);
    }
  };

  const useCurrentLocation = async () => {
    if (weatherLocating || saveState === "saving") return;
    setWeatherLocating(true);
    setWeatherDraftError(null);
    try {
      const location = await locateWeather(weatherDraft.temperatureUnit);
      await saveWeatherCity(location);
    } catch {
      setWeatherDraftError("无法获取当前位置；原天气配置已保留。请检查 Windows 定位权限或改用城市选择。");
    } finally {
      setWeatherLocating(false);
    }
  };

  const clearWeather = async () => {
    weatherSearchRevision.current++;
    setWeatherSearching(false);
    setWeatherCities([]);
    const saved = await change({ weather: null });
    if (!saved) return;
    setWeatherDraft(weatherDraftFromSettings(null));
    setWeatherDraftError(null);
  };

  const statusText = saveFailure ?? (
    saveState === "saving"
      ? "正在保存到本机…"
      : saveState === "saved"
        ? "设置已保存在本机。"
        : notice ?? "设置会自动保存在本机。"
  );
  const statusKind = saveState === "failed" || (notice !== null && saveState === "idle")
    ? "warning"
    : "saved";

  return (
    <section
      aria-label="偏好设置"
      aria-labelledby="settings-heading"
      className={`shell-settings-panel settings-window${windowFrame ? " has-window-frame" : ""} edge-${settings.edge}`}
      role="dialog"
    >
      {windowFrame ? (
        <header className="settings-window-chrome" onPointerDown={(event) => {
          if (event.button !== 0) return;
          if (event.target instanceof Element && event.target.closest(".settings-window-controls")) return;
          event.preventDefault();
          windowFrame.onDragStart();
        }}>
          <div className="settings-window-title">
            <LocalIcon className="settings-window-title-icon" name="blocks" />
            <span>Widget Platform 偏好设置</span>
          </div>
          <div className="settings-window-controls">
            <button aria-label="最小化设置窗口" onPointerDown={(event) => event.stopPropagation()} onClick={windowFrame.onMinimize} type="button">−</button>
            <button aria-label="关闭设置窗口" className="is-close" onPointerDown={(event) => event.stopPropagation()} onClick={windowFrame.onClose} type="button">×</button>
          </div>
        </header>
      ) : null}
      {windowFrame ? createPortal(<>
        <div aria-hidden="true" className="settings-window-resize resize-west" onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          windowFrame.onResizeStart("West");
        }} />
        <div aria-hidden="true" className="settings-window-resize resize-east" onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          windowFrame.onResizeStart("East");
        }} />
        <div aria-hidden="true" className="settings-window-resize resize-south-west" onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          windowFrame.onResizeStart("SouthWest");
        }} />
        <div aria-hidden="true" className="settings-window-resize resize-south-east" onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          windowFrame.onResizeStart("SouthEast");
        }} />
      </>, document.body) : null}
      <aside className="settings-side">
        <div className="settings-brand">
          <span aria-hidden="true" className="settings-brand-mark"><LocalIcon className="settings-brand-icon" name="blocks" /></span>
          <span className="settings-brand-copy">
            <strong>Widget Platform</strong>
            <small>偏好设置</small>
          </span>
        </div>
        <nav aria-label="设置分类" className="settings-nav">
          {TABS.map((tab) => (
            <button
              aria-current={activeTab === tab.id ? "page" : undefined}
              aria-label={tab.label}
              className={`settings-nav-button${activeTab === tab.id ? " is-selected" : ""}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
              type="button"
            >
              <LocalIcon className="settings-nav-icon" name={tab.icon} />
              <span className="settings-nav-label">{tab.label}</span>
            </button>
          ))}
        </nav>
        <p className="settings-side-note">数据保存在此应用的本机设置目录。</p>
      </aside>

      <div className="settings-main">
        <div className="settings-topline">
          <div className="settings-heading-copy">
            <h1 className="settings-heading" id="settings-heading">{activeTabInfo.label}</h1>
            <p className="settings-subheading">{activeTabInfo.subtitle}</p>
          </div>
          <button
            aria-label="关闭设置"
            className="settings-close-button"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <LocalIcon className="settings-close-icon" name="x" />
          </button>
        </div>

        <div className="settings-content">
          {activeTab === "modules" ? (
            <>
              <section className="settings-section">
                <div className="settings-section-heading">
                  <h2>显示的模块</h2>
                  <span className="settings-count">{activeIds.length} 个</span>
                </div>
                <p className="settings-description">
                  调整摘要栏中的图标与顺序。数据尚未接入的入口会显示空状态，不展示示例读数。
                </p>
                <div className="settings-card" role="list" aria-label="已启用模块">
                  {activeIds.length > 0 ? activeIds.map((id, index) => {
                    const module = CONTENT_REGISTRY.find((entry) => entry.id === id);
                    if (!module) return null;
                    return (
                      <div className="module-setting-row" key={id} role="listitem">
                        <div className="setting-module-name">
                          <span className="tiny-orbit"><LocalIcon className="tiny-module-icon" name={module.icon} /></span>
                          <span className="setting-module-copy">
                            <strong>{module.label}</strong>
                            <small>{module.description}</small>
                          </span>
                        </div>
                        <div className="order-controls">
                          <button
                            aria-label={`上移 ${module.label}`}
                            className="order-button"
                            disabled={index === 0}
                            onClick={() => void change({
                              enabledContentIds: moveContentId(activeIds, index, -1),
                            })}
                            type="button"
                          ><LocalIcon className="order-icon" name="arrow-up" /></button>
                          <button
                            aria-label={`下移 ${module.label}`}
                            className="order-button"
                            disabled={index === activeIds.length - 1}
                            onClick={() => void change({
                              enabledContentIds: moveContentId(activeIds, index, 1),
                            })}
                            type="button"
                          ><LocalIcon className="order-icon" name="arrow-down" /></button>
                        </div>
                        <button
                          aria-label={`隐藏 ${module.label}`}
                          aria-pressed="true"
                          className="module-toggle"
                          onClick={() => void change({
                            enabledContentIds: activeIds.filter((candidate) => candidate !== id),
                          })}
                          title={`隐藏 ${module.label}`}
                          type="button"
                        />
                      </div>
                    );
                  }) : (
                    <p className="settings-empty-row">当前没有显示的模块；可从下方添加入口。</p>
                  )}
                </div>
              </section>

              {availableModules.length > 0 ? (
                <section className="settings-section">
                  <h2 className="settings-section-title">可添加模块</h2>
                  <p className="settings-description">添加后会出现在摘要栏末尾，可再调整顺序。</p>
                  <div className="settings-card" role="list" aria-label="可添加模块">
                    {availableModules.map((module) => (
                      <div className="module-setting-row" key={module.id} role="listitem">
                        <div className="setting-module-name">
                          <span className="tiny-orbit"><LocalIcon className="tiny-module-icon" name={module.icon} /></span>
                          <span className="setting-module-copy">
                            <strong>{module.label}</strong>
                            <small>{module.description}</small>
                          </span>
                        </div>
                        <button
                          className="add-module-button"
                          onClick={() => void change({
                            enabledContentIds: [...activeIds, module.id],
                          })}
                          type="button"
                        >添加</button>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          {activeTab === "services" ? (
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>天气服务</h2>
                <span className="settings-count">{settings.weather ? "已配置" : "未配置"}</span>
              </div>
              <p className="settings-description">
                可填写城市名称，也可主动获取一次当前位置；定位不会持续追踪，天气数据缓存至少 30 分钟。
              </p>
              <div className="settings-card weather-settings-card">
                <label className="weather-settings-field weather-settings-field-wide">
                  <span>城市名称</span>
                  <input
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      weatherSearchRevision.current++;
                      setWeatherSearching(false);
                      setWeatherCities([]);
                      setWeatherDraftError(null);
                      setWeatherDraft((current) => ({ ...current, name: value }));
                    }}
                    placeholder="例如：杭州"
                    type="text"
                    value={weatherDraft.name}
                  />
                </label>

                <div className="weather-settings-field weather-settings-field-wide">
                  <span>温度单位</span>
                  <div aria-label="温度单位" className="settings-segmented">
                    <button
                      aria-pressed={weatherDraft.temperatureUnit === "celsius"}
                      className={weatherDraft.temperatureUnit === "celsius" ? "is-selected" : ""}
                      onClick={() => setWeatherDraft((current) => ({ ...current, temperatureUnit: "celsius" }))}
                      type="button"
                    >摄氏 °C</button>
                    <button
                      aria-pressed={weatherDraft.temperatureUnit === "fahrenheit"}
                      className={weatherDraft.temperatureUnit === "fahrenheit" ? "is-selected" : ""}
                      onClick={() => setWeatherDraft((current) => ({ ...current, temperatureUnit: "fahrenheit" }))}
                      type="button"
                    >华氏 °F</button>
                  </div>
                </div>
                {weatherDraftError ? <p className="weather-settings-error" role="alert">{weatherDraftError}</p> : null}
                {weatherCities.length > 1 ? (
                  <div className="weather-settings-field weather-settings-field-wide" aria-label="选择天气城市">
                    <span>找到多个城市，请选择</span>
                    {weatherCities.map((city) => (
                      <button className="settings-mini-action" key={`${city.latitude}:${city.longitude}`} onClick={() => void saveWeatherCity(city)} disabled={saveState === "saving"} type="button">{city.label}</button>
                    ))}
                  </div>
                ) : null}
                <div className="weather-settings-actions weather-settings-field-wide">
                  <button className="settings-mini-action" disabled={weatherLocating || saveState === "saving"} onClick={() => void useCurrentLocation()} type="button">{weatherLocating ? "正在定位…" : "设为当前位置"}</button>
                  <button className="settings-mini-action" disabled={weatherSearching || saveState === "saving"} onClick={() => void saveWeather()} type="button">{weatherSearching ? "正在查询城市…" : "保存天气配置"}</button>
                  <button className="settings-mini-action" disabled={!settings.weather || weatherSearching || saveState === "saving"} onClick={() => void clearWeather()} type="button">清除配置</button>
                </div>
              </div>
              <p className="settings-description weather-settings-source">
                天气来源 Open-Meteo，城市来源 GeoNames；当前免费端点仅用于本项目非商业自用。
              </p>
            </section>
          ) : null}

          {activeTab === "appearance" ? (
            <>
              <section className="settings-section">
                <h2 className="settings-section-title">显示</h2>
                <p className="settings-description">隐藏时，卡片原位置保留一条白色提示条，点击即可重新显示。</p>
                <div aria-label="显示方式" className="settings-segmented">
                  <button
                    aria-pressed={settings.visibility === "always"}
                    className={settings.visibility === "always" ? "is-selected" : ""}
                    onClick={() => void setVisibility("always")}
                    type="button"
                  >始终显示</button>
                  <button
                    aria-pressed={settings.visibility === "hidden"}
                    className={settings.visibility === "hidden" ? "is-selected" : ""}
                    onClick={() => void setVisibility("hidden")}
                    type="button"
                  >隐藏显示</button>
                </div>
              </section>

              <section className="settings-section">
                <h2 className="settings-section-title">背景材质</h2>
                <p className="settings-description">透明度和背景效果只影响导航条表面，不影响文字、图标、详情面板或设置窗口。</p>
                <div aria-label="背景材质" className="settings-segmented settings-segmented-three">
                  {BACKGROUND_MATERIALS.map(({ id, label }) => (
                    <button
                      aria-pressed={settings.dockMaterial === id}
                      className={settings.dockMaterial === id ? "is-selected" : ""}
                      key={id}
                      onClick={() => void change({ dockMaterial: id })}
                      type="button"
                    >{label}</button>
                  ))}
                </div>
                {settings.dockMaterial !== "solid" ? (
                  <div className="settings-card settings-material-card">
                  {settings.dockMaterial === "translucent" ? <div className="settings-slider-row">
                    <label htmlFor="settings-dock-opacity">背景透明度</label>
                    <output htmlFor="settings-dock-opacity">{settings.dockOpacity ?? 100}%</output>
                    <input
                      aria-label="设置背景透明度"
                      id="settings-dock-opacity"
                      max={100}
                      min={0}
                      onChange={(event) => void change({ dockOpacity: Number(event.currentTarget.value) })}
                      type="range"
                      value={settings.dockOpacity ?? 100}
                    />
                    <small>背景不透明度越低，背景越容易透出。</small>
                  </div> : null}
                  {settings.dockMaterial === "glass" ? <div className="settings-slider-row">
                      <label htmlFor="settings-dock-blur">模糊强度</label>
                      <output htmlFor="settings-dock-blur">{settings.dockBlur} px</output>
                      <input
                        aria-label="设置模糊强度"
                        id="settings-dock-blur"
                        max={32}
                        min={0}
                        onChange={(event) => void change({ dockBlur: Number(event.currentTarget.value) })}
                        type="range"
                        value={settings.dockBlur}
                      />
                      <small>默认 16 px。</small>
                    </div> : null}
                  </div>
                ) : null}
              </section>

              <section className="settings-section">
                <div className="settings-section-heading">
                  <h2>卡片大小</h2>
                  <span className="settings-count">{layout.longSide} × {layout.thickness} px</span>
                </div>
                <p className="settings-description">
                  四边共用长边与厚度；卡片按排数自动扩展，屏幕不足时安全换行，图标不会缩小。
                </p>
                <div className="settings-card settings-dimensions">
                  <DimensionControl
                    label="卡片长边"
                    maximum={SETTING_LIMITS.longSide.maximum}
                    minimum={SETTING_LIMITS.longSide.minimum}
                    onChange={(longSide) => void change({ longSide })}
                    value={settings.longSide}
                  />
                  <DimensionControl
                    label="卡片厚度"
                    maximum={SETTING_LIMITS.thickness.maximum}
                    minimum={SETTING_LIMITS.thickness.minimum}
                    onChange={(thickness) => void change({ thickness })}
                    value={settings.thickness}
                  />
                </div>
              </section>

              <section className="settings-section">
                <h2 className="settings-section-title">模块排数</h2>
                <p className="settings-description">默认一排；左右停靠时对应为列数。屏幕不足时会自动增加排数。</p>
                <div aria-label="模块排数" className="settings-segmented settings-segmented-four">
                  {[1, 2, 3, 4].map((rows) => (
                    <button key={rows} aria-pressed={settings.rows === rows} className={settings.rows === rows ? "is-selected" : ""} onClick={() => void change({ rows })} type="button">{["一排", "两排", "三排", "四排"][rows - 1]}</button>
                  ))}
                </div>
              </section>

              <section className="settings-section">
                <h2 className="settings-section-title">图标大小</h2>
                <p className="settings-description">只改变圆形图标，不随卡片宽高自动缩放。</p>
                <div className="settings-card">
                  <div className="settings-slider-row">
                    <label htmlFor="settings-icon-size">图标直径</label>
                    <output htmlFor="settings-icon-size">{settings.iconSize} px</output>
                    <input
                      id="settings-icon-size"
                      max={SETTING_LIMITS.iconSize.maximum}
                      min={SETTING_LIMITS.iconSize.minimum}
                      onChange={(event) => void change({ iconSize: Number(event.currentTarget.value) })}
                      type="range"
                      value={settings.iconSize}
                    />
                    <small>{SETTING_LIMITS.iconSize.minimum}–{SETTING_LIMITS.iconSize.maximum} px；点击区域略大于图标，卡片按内容安全布局。</small>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {activeTab === "behavior" ? (
            <>
              <section className="settings-section">
                <h2 className="settings-section-title">停靠边缘</h2>
                <p className="settings-description">拖动手柄只选择四个边缘中心；目标外松手保持原停靠位置。</p>
                <div aria-label="停靠边缘" className="settings-segmented settings-segmented-four">
                  {EDGE_OPTIONS.map(({ id, label }) => (
                    <button
                      aria-pressed={settings.edge === id}
                      className={settings.edge === id ? "is-selected" : ""}
                      key={id}
                      onClick={() => void change({ edge: id, edgeOffset: 0.5 })}
                      type="button"
                    >{label}</button>
                  ))}
                </div>
              </section>
              <section className="settings-section">
                <h2 className="settings-section-title">当前布局</h2>
                <div className="settings-card">
                  <div className="settings-behavior-row">
                    <span>
                      <strong>{EDGE_OPTIONS.find(({ id }) => id === settings.edge)?.label}停靠</strong>
                      <small>重新居中会把组件放回当前边缘中央。</small>
                    </span>
                    <button
                      className="settings-mini-action"
                      onClick={() => void change({ edgeOffset: 0.5 })}
                      type="button"
                    >重新居中</button>
                  </div>
                </div>
              </section>
              <section className="settings-section">
                <h2 className="settings-section-title">收起</h2>
                <p className="settings-description">主体收起后，同侧原位置保留提示条；点击提示条可恢复。</p>
                <button
                  className="settings-hide-action"
                  onClick={() => void setVisibility("hidden")}
                  type="button"
                >立即收起</button>
              </section>
            </>
          ) : null}
        </div>

        <div
          aria-live={saveFailure ? "assertive" : "polite"}
          className={`settings-status ${statusKind}`}
          data-save-state={saveState}
          role={saveFailure ? "alert" : "status"}
        >
          <span aria-hidden="true" className="settings-status-dot" />
          <span>{statusText}</span>
        </div>
      </div>
    </section>
  );
}

type DimensionControlProps = {
  label: string;
  minimum: number;
  maximum: number;
  value: number;
  onChange: (value: number) => void;
};

function DimensionControl({ label, minimum, maximum, value, onChange }: DimensionControlProps) {
  const id = label === "卡片长边" ? "settings-long-side" : "settings-thickness";
  const update = (raw: string) => onChange(numberFromInput(raw, minimum, maximum));

  return (
    <div className="settings-dimension-field">
      <label htmlFor={id}>{label}</label>
      <input
        aria-label={`${label}像素`}
        id={id}
        max={maximum}
        min={minimum}
        onChange={(event) => update(event.currentTarget.value)}
        type="number"
        value={value}
      />
      <input
        aria-label={`${label}滑块`}
        max={maximum}
        min={minimum}
        onChange={(event) => update(event.currentTarget.value)}
        type="range"
        value={value}
      />
      <small>{minimum}–{maximum} px</small>
    </div>
  );
}
