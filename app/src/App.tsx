import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ShellFrame } from "./shell/ShellFrame";
import {
  DEFAULT_WIDGET_SETTINGS,
  parseWidgetSettings,
  type SettingsLoadResult,
  type WidgetSettings,
} from "./settings/settings-model";
import { CounterProbe } from "./shared/CounterProbe";
import { SettingsWindowApp } from "./settings/SettingsWindowApp";
import { DragPreviewWindowApp } from "./shell/DragPreviewWindowApp";

type LoadedSettings = {
  settings: WidgetSettings;
  notice: string | null;
  failure: string | null;
};

async function saveSettings(settings: WidgetSettings): Promise<void> {
  await invoke("settings_save", { settings });
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "未知错误";
}

export function App() {
  if (new URLSearchParams(window.location.search).get("window") === "settings") {
    return <SettingsWindowApp />;
  }
  if (new URLSearchParams(window.location.search).get("window") === "drag-preview") {
    return <DragPreviewWindowApp />;
  }
  const developmentProbe = import.meta.env.DEV && new URLSearchParams(window.location.search).get("g2c") === "ipc";
  const releaseProbe = import.meta.env.VITE_G2C_PROBE === "true";
  const isCounterProbe = developmentProbe || releaseProbe;
  return isCounterProbe ? <CounterProbe /> : <WidgetApp />;
}

function WidgetApp() {
  const [loaded, setLoaded] = useState<LoadedSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invoke<SettingsLoadResult>("settings_load").then((result) => {
      const settings = parseWidgetSettings(result.settings);
      if (cancelled) return;
      setLoaded({
        settings,
        notice: typeof result.notice === "string" ? result.notice : null,
        failure: null,
      });
    }).catch((error: unknown) => {
      if (cancelled) return;
      setLoaded({
        settings: DEFAULT_WIDGET_SETTINGS,
        notice: null,
        failure: `无法读取本机设置，已载入默认值；为避免覆盖原文件，本次运行不会保存设置。${describeError(error)}`,
      });
    });
    return () => { cancelled = true; };
  }, []);

  if (!loaded) return null;

  return (
    <ShellFrame
      initialSettings={loaded.settings}
      settingsLoadFailure={loaded.failure}
      settingsNotice={loaded.notice}
      persistSettings={loaded.failure ? undefined : saveSettings}
    />
  );
}
