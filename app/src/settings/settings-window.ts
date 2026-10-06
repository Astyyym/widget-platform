import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export const SETTINGS_WINDOW_LABEL = "settings";
export const SETTINGS_WINDOW_DEFAULT_SIZE = { width: 620, height: 520 } as const;

export async function toggleSettingsWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(SETTINGS_WINDOW_LABEL);
  if (existing) {
    if (await existing.isVisible()) {
      await existing.hide();
    } else {
      await existing.show();
      await existing.setFocus();
    }
    return;
  }
  const settingsWindow = new WebviewWindow(SETTINGS_WINDOW_LABEL, {
    title: "Widget Platform 偏好设置",
    url: "index.html?window=settings",
    width: SETTINGS_WINDOW_DEFAULT_SIZE.width,
    height: SETTINGS_WINDOW_DEFAULT_SIZE.height,
    minWidth: 560,
    minHeight: 460,
    resizable: true,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    visible: true,
    focus: true,
    center: true,
  });
  await new Promise<void>((resolve, reject) => {
    void settingsWindow.once("tauri://created", () => resolve());
    void settingsWindow.once("tauri://error", (event) => reject(event.payload));
  });
}