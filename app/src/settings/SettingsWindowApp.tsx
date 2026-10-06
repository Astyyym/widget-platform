import { useEffect, useRef, useState } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { SettingsPanel } from "./SettingsPanel";
import {
  DEFAULT_WIDGET_SETTINGS,
  parseWidgetSettings,
  type SettingsLoadResult,
  type WidgetSettings,
} from "./settings-model";
import { calculateShellLayout } from "../shell/shell-layout";
import "../shell/shell-frame.css";

export function SettingsWindowApp() {
  const [settings, setSettings] = useState<WidgetSettings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("settings-host");
    document.body.classList.add("settings-host");
    return () => {
      document.documentElement.classList.remove("settings-host");
      document.body.classList.remove("settings-host");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void invoke<SettingsLoadResult>("settings_load").then((result) => {
      if (cancelled) return;
      setSettings(parseWidgetSettings(result.settings));
      setNotice(result.notice);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setSettings(DEFAULT_WIDGET_SETTINGS);
      setFailure(error instanceof Error ? error.message : "无法读取设置。");
      setSaveState("failed");
    });
    return () => { cancelled = true; };
  }, []);

  if (!settings) return null;

  const appWindow = getCurrentWebviewWindow();

  const onChange = async (next: WidgetSettings): Promise<boolean> => {
    setSaveState("saving");
    setFailure(null);
    try {
      await invoke("settings_save", { settings: next });
      const canonical = parseWidgetSettings(next);
      setSettings(canonical);
      await emitTo("main", "settings-updated", canonical);
      setSaveState("saved");
      return true;
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : "设置保存失败。");
      setSaveState("failed");
      return false;
    }
  };

  const layout = calculateShellLayout({
    stageWidth: window.innerWidth,
    stageHeight: window.innerHeight,
    edge: settings.edge,
    itemCount: settings.enabledContentIds.length,
    iconSize: settings.iconSize,
    ringMode: "off",
    longSide: settings.longSide,
    thickness: settings.thickness,
    rows: settings.rows,

  });

  return <SettingsPanel
    closeButtonRef={closeButtonRef}
    layout={layout}
    notice={notice}
    onChange={onChange}
    onClose={() => { void getCurrentWebviewWindow().close(); }}
    saveFailure={failure}
    saveState={saveState}
    settings={settings}
    windowFrame={{
      onClose: () => { void appWindow.close(); },
      onMinimize: () => { void appWindow.minimize(); },
      onDragStart: () => { void appWindow.startDragging(); },
      onResizeStart: (direction: "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest") => { void appWindow.startResizeDragging(direction); },
    }}
  />;
}