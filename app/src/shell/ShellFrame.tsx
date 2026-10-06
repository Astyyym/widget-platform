import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  calculateShellLayout,
  resolveShellDrop,
  shellDragPreviewPosition,
  shellModuleGridPosition,
  type ShellDropTarget,
  type ShellEdge,
  type ShellPoint,
  type ShellRect,
  type ShellRingMode,
} from "./shell-layout";
import {
  INITIAL_SHELL_INTERACTION_STATE,
  reduceShellInteraction,
  shouldDeferHoverClearWhilePressed,
  type ShellInteractionAction,
  type ShellInteractionState,
} from "./shell-view";
import {
  createWidgetWindowController,
  widgetWindowMode,
  type WidgetWindowController,
} from "./native-widget-window";
import { POPOVER_INSET, POPOVER_WIDTH, shellPopoverPosition, type PopoverSize } from "./popover-layout";
import { ACTIVITY_PANEL_GAP, ACTIVITY_PANEL_INSET, activityPanelSize } from "./activity-panel-layout";
import { SettingsPanel } from "../settings/SettingsPanel";
import { toggleSettingsWindow } from "../settings/settings-window";
import { closeDragPreviewWindow, openDragPreviewWindow, previewEdgeAtCursor, resetDragPreviewCandidate, updateDragPreview } from "./drag-preview-window";
import { LocalIcon, resolveSummaryIcon, resolveWeatherCodeIcon, type IconName } from "./LocalIcon";
import { CodexPanel } from "../features/codex/CodexPanel";
import {
  formatCodexQuotaSummary,
  getCodexQuotaProgress,
} from "../features/codex/codex-quota-model";
import { codexQuotaBridge } from "../features/codex/codex-bridge";
import {
  CodexQuotaStore,
  shouldConnectCodexQuota,
} from "../features/codex/codex-quota-store";
import { todoBridge } from "../features/todo/todo-bridge";
import {
  TodoSnapshotStore,
  type TodoError,
  type TodoSyncStatus,
} from "../features/todo/todo-store";
import { getTodoSummaryPresentation } from "../features/todo/todo-summary-model";
import { MetricsPanel } from "../features/metrics/MetricsPanel";
import { metricsBridge } from "../features/metrics/metrics-bridge";
import {
  formatCpuSummary,
  formatMemorySummary,
  shouldSampleMetrics,
  type MetricsViewState,
} from "../features/metrics/metrics-model";
import { MetricsSnapshotStore } from "../features/metrics/metrics-store";
import { TodoPanel } from "../features/todo/TodoPanel";
import { TimerPanel } from "../features/timer/TimerPanel";
import { timerBridge } from "../features/timer/timer-bridge";
import { timerCountdownProgress } from "../features/timer/timer-progress";
import { MediaPanel } from "../features/media/MediaPanel";
import { mediaBridge } from "../features/media/media-bridge";
import {
  formatMediaModuleSummary,
  resolveCurrentMediaSession,
} from "../features/media/media-panel-model";
import { MediaSnapshotStore } from "../features/media/media-store";
import { MediaPreviewCard } from "../features/media/MediaPreviewCard";
import { WeatherPanel } from "../features/weather/WeatherPanel";
import { WeatherPreviewCard } from "../features/weather/WeatherPreviewCard";
import { ClipboardPanel } from "../features/clipboard/ClipboardPanel";
import { clipboardBridge } from "../features/clipboard/clipboard-bridge";
import { clipboardListenerShouldRun } from "../features/clipboard/clipboard-lifecycle";
import { ClipboardSnapshotStore } from "../features/clipboard/clipboard-store";
import { weatherBridge } from "../features/weather/weather-bridge";
import {
  formatWeatherSummary,
  formatWeatherTime,
  weatherSymbol,
} from "../features/weather/weather-model";
import {
  shouldConnectWeather,
  WeatherSnapshotStore,
} from "../features/weather/weather-store";
import {
  parseTimerError,
  TimerSnapshotStore,
  type TimerSnapshot,
} from "../features/timer/timer-store";
import {
  CONTENT_REGISTRY,
  DEFAULT_WIDGET_SETTINGS,
  type WidgetSettings,
} from "../settings/settings-model";
import "./shell-frame.css";

export type ShellModule = {
  id: string;
  label: string;
  symbol: string;
  progress?: number;
  previewLabel?: string;
  /**
   * Optional module-specific popover body. When present it replaces the plain
   * `previewLabel` line, letting a module show a richer (display-only) summary
   * in the hover popover. The popover is an aria-hidden tooltip, so content
   * here must stay non-interactive.
   */
  previewContent?: ReactNode;
  accessibleLabel?: string;
  symbolVariant?: "readout";
  icon?: IconName;
};

export type ShellFrameProps = {
  modules?: readonly ShellModule[];
  edge?: ShellEdge;
  longSide?: number;
  thickness?: number;
  iconSize?: number;
  ringMode?: ShellRingMode;
  isFixture?: boolean;
  initialSettings?: WidgetSettings;
  settingsNotice?: string | null;
  settingsLoadFailure?: string | null;
  persistSettings?: (settings: WidgetSettings) => Promise<void>;
};

type SaveState = "idle" | "saving" | "saved" | "failed";

export const DEFAULT_SHELL_MODULES: readonly ShellModule[] = [
  { id: "todo", label: "待办", symbol: "✓" },
  { id: "focus", label: "专注", symbol: "◷" },
  { id: "cpu", label: "CPU", symbol: "CPU" },
  { id: "gpu", label: "GPU", symbol: "GPU" },

  { id: "memory", label: "内存", symbol: "▥" },
  { id: "media", label: "媒体", symbol: "♫" },
  { id: "codex", label: "Codex", symbol: "C" },
  { id: "weather", label: "天气", symbol: "☼" },
];

const EDGES: readonly ShellEdge[] = ["top", "right", "bottom", "left"];
const PANEL_BOOTSTRAP_SIZE: PopoverSize = { width: 380, height: 420 };
const EDGE_LABELS: Record<ShellEdge, string> = {
  top: "顶部",
  right: "右侧",
  bottom: "底部",
  left: "左侧",
};

type StageSize = { width: number; height: number };
type DragPosition = { left: number; top: number };
type DragSession = {
  pointerId: number;
  offsetX: number;
  offsetY: number;
};
type PopoverPosition = { left: number; top: number; moduleId: string };

function readStageSize(element: HTMLElement): StageSize {
  const { width, height } = element.getBoundingClientRect();
  return { width, height };
}

function clampProgress(progress: number | undefined): number | undefined {
  if (progress === undefined || !Number.isFinite(progress)) return undefined;
  return Math.max(0, Math.min(100, progress));
}

function timerRemaining(
  snapshot: TimerSnapshot | null,
  now: number,
): number | null {
  if (!snapshot) return null;
  if (
    snapshot.state === "running" &&
    snapshot.deadlineUtc !== null &&
    !snapshot.clockAnomaly
  ) {
    return Math.max(0, snapshot.deadlineUtc - now);
  }
  return snapshot.remainingMs;
}

function formatTimerSummary(
  snapshot: TimerSnapshot | null,
  now: number,
  failure: string | null,
): string {
  if (failure) return "计时数据不可用";
  if (!snapshot) return "正在读取计时";
  const remaining = timerRemaining(snapshot, now) ?? 0;
  const totalSeconds = Math.ceil(remaining / 1000);
  const clock = `${Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0")}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
  const phase = snapshot.phase === "focus" ? "专注" : "休息";
  const state =
    snapshot.state === "running"
      ? "进行中"
      : snapshot.state === "paused"
        ? "已暂停"
        : snapshot.state === "completed"
          ? "已完成"
          : "待开始";
  return `${clock} · ${phase} · ${state}`;
}

function asLocalRect(rect: DOMRect, stageRect: DOMRect): ShellRect {
  return {
    left: rect.left - stageRect.left,
    top: rect.top - stageRect.top,
    width: rect.width,
    height: rect.height,
  };
}

function pointerInStage(
  event: ReactPointerEvent,
  stage: HTMLElement,
): ShellPoint {
  const rect = stage.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

export function widgetDimensions(settings: WidgetSettings, ringMode: ShellRingMode) {
  const layout = calculateShellLayout({
    // The monitor is the available space, not the current compact WebView.
    stageWidth: typeof window !== "undefined" ? window.screen?.availWidth ?? 1920 : 1920,
    stageHeight: typeof window !== "undefined" ? window.screen?.availHeight ?? 1080 : 1080,
    edge: settings.edge,
    itemCount: settings.enabledContentIds.length,
    iconSize: settings.iconSize,
    ringMode,
    longSide: settings.longSide,
    thickness: settings.thickness,
    rows: settings.rows,
  });
  return layout;
}

async function nativeHoverTarget(): Promise<{
  moduleId: string | null;
  inDock: boolean;
}> {
  const appWindow = getCurrentWindow();
  const [cursor, windowPosition] = await Promise.all([
    cursorPosition(),
    appWindow.outerPosition(),
  ]);
  const scale = window.devicePixelRatio || 1;
  const target = document.elementFromPoint(
    (cursor.x - windowPosition.x) / scale,
    (cursor.y - windowPosition.y) / scale,
  );
  return {
    moduleId:
      target?.closest<HTMLButtonElement>(".shell-module-hit-area")?.dataset
        .moduleId ?? null,
    inDock: Boolean(target?.closest(".shell-dock")),
  };
}

export function ShellFrame({
  modules: suppliedModules,
  edge: initialEdge = "top",
  longSide = 260,
  thickness = 80,
  iconSize = 46,
  ringMode = "off",
  isFixture = false,
  initialSettings,
  settingsNotice: initialNotice = null,
  settingsLoadFailure = null,
  persistSettings,
}: ShellFrameProps) {
  const stageRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const targetRefs = useRef(new Map<ShellEdge, HTMLDivElement>());
  const moduleButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const panelCloseRef = useRef<HTMLButtonElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const modulePointerDown = useRef(false);
  const restoringPanelFocus = useRef(false);
  const previousPanelId = useRef<string | null>(null);
  const previousSettingsOpen = useRef(false);
  const dragSession = useRef<DragSession | null>(null);
  const nativeWindow = useRef<WidgetWindowController | null>(null);
  const hoverClearTimer = useRef<number | null>(null);
  const hoverClearRevision = useRef(0);
  const [interaction, setInteraction] = useState<ShellInteractionState>(() => ({
    ...INITIAL_SHELL_INTERACTION_STATE,
    hidden: (initialSettings?.visibility ?? "always") === "hidden",
  }));
  const [settings, setSettings] = useState<WidgetSettings>(
    () =>
      initialSettings ?? {
        ...DEFAULT_WIDGET_SETTINGS,
        edge: initialEdge,
        longSide,
        thickness,
        iconSize,
      },
  );
  const settingsRef = useRef(settings);
  const lastSavedSettings = useRef(settings);
  const settingsWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const settingsRevision = useRef(0);
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [saveFailure, setSaveFailure] = useState<string | null>(
    settingsLoadFailure,
  );
  const [saveState, setSaveState] = useState<SaveState>(
    settingsLoadFailure ? "failed" : "idle",
  );
  const timerStoreRef = useRef<TimerSnapshotStore | null>(null);
  if (!timerStoreRef.current) timerStoreRef.current = new TimerSnapshotStore();
  const [timerSnapshot, setTimerSnapshot] = useState<TimerSnapshot | null>(
    () => timerStoreRef.current?.getSnapshot() ?? null,
  );
  const [timerFailure, setTimerFailure] = useState<string | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const todoStoreRef = useRef<TodoSnapshotStore | null>(null);
  if (!todoStoreRef.current) todoStoreRef.current = new TodoSnapshotStore();
  // Closing or switching panels unmounts TodoPanel, not its unsaved draft.
  const [todoDraft, setTodoDraft] = useState("");
  const [todoSnapshot, setTodoSnapshot] = useState(() =>
    todoStoreRef.current!.getSnapshot(),
  );
  const [todoSyncStatus, setTodoSyncStatus] = useState<TodoSyncStatus>(() =>
    todoStoreRef.current!.getSyncStatus(),
  );
  const [todoFailure, setTodoFailure] = useState<TodoError | null>(null);
  const [todoDisplayPhase, setTodoDisplayPhase] = useState(0);
  const metricsStoreRef = useRef<MetricsSnapshotStore | null>(null);
  if (!metricsStoreRef.current) {
    metricsStoreRef.current = new MetricsSnapshotStore();
  }
  const [metricsView, setMetricsView] = useState<MetricsViewState>(() =>
    metricsStoreRef.current!.getState(),
  );
  const codexQuotaStoreRef = useRef<CodexQuotaStore | null>(null);
  if (!codexQuotaStoreRef.current) {
    codexQuotaStoreRef.current = new CodexQuotaStore();
  }
  const [codexQuotaView, setCodexQuotaView] = useState(() =>
    codexQuotaStoreRef.current!.getState(),
  );
  const weatherStoreRef = useRef<WeatherSnapshotStore | null>(null);
  if (!weatherStoreRef.current) {
    weatherStoreRef.current = new WeatherSnapshotStore();
  }
  const [weatherView, setWeatherView] = useState(() =>
    weatherStoreRef.current!.getState(),
  );
  const mediaStoreRef = useRef<MediaSnapshotStore | null>(null);
  if (!mediaStoreRef.current) mediaStoreRef.current = new MediaSnapshotStore();
  const [mediaView, setMediaView] = useState(() =>
    mediaStoreRef.current!.getState(),
  );
  const clipboardStoreRef = useRef<ClipboardSnapshotStore | null>(null);
  if (!clipboardStoreRef.current) {
    clipboardStoreRef.current = new ClipboardSnapshotStore(clipboardBridge);
  }
  const [clipboardView, setClipboardView] = useState(() =>
    clipboardStoreRef.current!.getState(),
  );
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const [dragPosition, setDragPosition] = useState<DragPosition | null>(null);
  const [previewEdge, setPreviewEdge] = useState<ShellEdge | null>(null);
  const [popoverPosition, setPopoverPosition] =
    useState<PopoverPosition | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverSize, setPopoverSize] = useState<PopoverSize | null>(null);
  const [panelSize, setPanelSize] = useState<PopoverSize | null>(null);
  const [popoverIntentRevision, setPopoverIntentRevision] = useState(0);
  const [nativeGeometryReadyKey, setNativeGeometryReadyKey] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState<StageSize>({
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  });
  const interactionRef = useRef(interaction);
  interactionRef.current = interaction;
  const visibleMetricIds = suppliedModules
    ? suppliedModules.map((module) => module.id)
    : settings.enabledContentIds;
  const metricsConsumerVisible =
    !isFixture &&
    shouldSampleMetrics(
      visibleMetricIds,
      interaction.settingsOpen,
    );
  const mediaConsumerVisible =
    !isFixture &&
    documentVisible &&
    visibleMetricIds.includes("media") &&
    !interaction.settingsOpen;
  const todoConsumerVisible =
    !isFixture &&
    documentVisible &&
    visibleMetricIds.includes("todo") &&
    !interaction.settingsOpen;
  const codexConsumerVisible = shouldConnectCodexQuota({
    isFixture,
    documentVisible,
    moduleEnabled: visibleMetricIds.includes("codex"),
    panelActive: interaction.activeModuleId === "codex",
    hidden: interaction.hidden,
    settingsOpen: interaction.settingsOpen,
  });
  const weatherConsumerVisible = shouldConnectWeather({
    isFixture,
    documentVisible,
    moduleEnabled: visibleMetricIds.includes("weather"),
    hidden: interaction.hidden,
    settingsOpen: interaction.settingsOpen,
    location: settings.weather,
  });
  const clipboardModuleEnabled = clipboardListenerShouldRun({
    isFixture,
    moduleEnabled: visibleMetricIds.includes("clipboard"),
    hidden: interaction.hidden,
    settingsOpen: interaction.settingsOpen,
  });

  useEffect(() => {
    const store = metricsStoreRef.current!;
    const unsubscribe = store.subscribe(() => setMetricsView(store.getState()));
    setMetricsView(store.getState());
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (isFixture) return;
    let unlisten: (() => void) | undefined;
    void listen<WidgetSettings>("settings-updated", ({ payload }) => {
      settingsRef.current = payload;
      lastSavedSettings.current = payload;
      setSettings(payload);
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, [isFixture]);

  useEffect(() => {
    if (!metricsConsumerVisible) return;
    return metricsStoreRef.current!.connect(metricsBridge);
  }, [metricsConsumerVisible]);

  useEffect(() => {
    const store = codexQuotaStoreRef.current!;
    const unsubscribe = store.subscribe(() => setCodexQuotaView(store.getState()));
    setCodexQuotaView(store.getState());
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!codexConsumerVisible) return;
    return codexQuotaStoreRef.current!.connect(codexQuotaBridge);
  }, [codexConsumerVisible]);

  useEffect(() => {
    const store = weatherStoreRef.current!;
    const unsubscribe = store.subscribe(() => setWeatherView(store.getState()));
    setWeatherView(store.getState());
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!weatherConsumerVisible || !settings.weather) return;
    return weatherStoreRef.current!.connect(weatherBridge, settings.weather);
  }, [settings.weather, weatherConsumerVisible]);

  useEffect(() => {
    const store = todoStoreRef.current!;
    const unsubscribe = store.subscribe(() => {
      setTodoSnapshot(store.getSnapshot());
      const syncStatus = store.getSyncStatus();
      setTodoSyncStatus(syncStatus);
      if (syncStatus !== "failed") setTodoFailure(null);
    });
    setTodoSnapshot(store.getSnapshot());
    setTodoSyncStatus(store.getSyncStatus());
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!todoConsumerVisible) return;
    setTodoFailure(null);
    return todoStoreRef.current!.connect(todoBridge, setTodoFailure);
  }, [todoConsumerVisible]);

  useEffect(() => {
    if (!todoConsumerVisible || !todoSnapshot) return;
    const interval = window.setInterval(
      () => setTodoDisplayPhase((phase) => phase + 1),
      3_000,
    );
    return () => window.clearInterval(interval);
  }, [todoConsumerVisible, todoSnapshot !== null]);

  useEffect(() => {
    const store = mediaStoreRef.current!;
    const unsubscribe = store.subscribeToState(() =>
      setMediaView(store.getState()),
    );
    setMediaView(store.getState());
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!mediaConsumerVisible) return;
    return mediaStoreRef.current!.connect(mediaBridge);
  }, [mediaConsumerVisible]);

  useEffect(() => {
    const store = clipboardStoreRef.current!;
    const unsubscribe = store.subscribe(() => setClipboardView(store.getState()));
    setClipboardView(store.getState());
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (isFixture) return;
    const store = clipboardStoreRef.current!;
    void store.setEnabled(clipboardModuleEnabled);
    void store.refresh();
  }, [clipboardModuleEnabled, isFixture]);

  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", updateVisibility);
    return () =>
      document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    if (isFixture) return;
    const store = timerStoreRef.current!;
    const unsubscribe = store.subscribe(() =>
      setTimerSnapshot(store.getSnapshot()),
    );
    const disconnect = store.connect(timerBridge, (error) => {
      setTimerFailure(parseTimerError(error).message);
    });
    return () => {
      unsubscribe();
      disconnect();
    };
  }, [isFixture]);

  useEffect(() => {
    if (isFixture || timerSnapshot?.state !== "running") return;
    const tick = () => setTimerNow(Date.now());
    tick();
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [isFixture, timerSnapshot?.deadlineUtc, timerSnapshot?.state]);

  useEffect(() => {
    if (
      isFixture ||
      timerSnapshot?.state !== "running" ||
      timerSnapshot.deadlineUtc === null
    )
      return;
    const generation = timerSnapshot.generation;
    const deadline = timerSnapshot.deadlineUtc;
    let expired = false;
    const checkDeadline = () => {
      if (Date.now() < deadline || expired) return;
      expired = true;
      void timerBridge
        .expire(`timer-shell-expire-${generation}`, generation)
        .then((value) => {
          timerStoreRef.current?.acceptCommandSnapshot(value);
        })
        .catch((error: unknown) => {
          setTimerFailure(parseTimerError(error).message);
          expired = false;
        });
    };
    checkDeadline();
    const interval = window.setInterval(checkDeadline, 500);
    return () => window.clearInterval(interval);
  }, [
    isFixture,
    timerSnapshot?.deadlineUtc,
    timerSnapshot?.generation,
    timerSnapshot?.state,
  ]);

  const edge = settings.edge;
  const edgeOffset = settings.edgeOffset;
  const longSideValue = settings.longSide;
  const thicknessValue = settings.thickness;
  const iconSizeValue = settings.iconSize;
  const modules: readonly ShellModule[] =
    suppliedModules ??
    settings.enabledContentIds.flatMap((id): ShellModule[] => {
      const entry = CONTENT_REGISTRY.find((candidate) => candidate.id === id);
      if (!entry) return [];
      if (entry.id === "todo") {
        const presentation = getTodoSummaryPresentation(
          todoSnapshot,
          todoDisplayPhase,
          todoSyncStatus,
        );
        return [
          {
            id: entry.id,
            label: entry.label,
            symbol: presentation.symbol,
            icon: resolveSummaryIcon(
              entry.id,
              presentation.symbol,
              presentation.symbolVariant === "readout" ? "readout" : undefined,
            ) ?? undefined,
            symbolVariant:
              presentation.symbolVariant === "readout" ? "readout" : undefined,
            progress: presentation.progress,
            previewLabel: presentation.previewLabel,
            accessibleLabel: `${presentation.accessibleLabel}，打开活动面板`,
          },
        ];
      }
      if (entry.id === "focus") {
        const symbol =
          timerSnapshot?.state === "completed"
            ? "🔔"
            : timerSnapshot?.state === "running"
              ? "⌛"
              : entry.symbol;
        return [
          {
            id: entry.id,
            label: entry.label,
            symbol,
            icon: symbol === "🔔" ? "bell-ring" : symbol === "⌛" ? "timer" : "clock",
            progress: timerFailure ? undefined : timerCountdownProgress(timerSnapshot, timerNow),
            previewLabel: formatTimerSummary(
              timerSnapshot,
              timerNow,
              timerFailure,
            ),
          },
        ];
      }
      if (entry.id === "gpu") {
        const gpu = metricsView.snapshot?.gpus[0];
        return [
          {
            id: entry.id,
            label: entry.label,
            symbol: entry.symbol,
            icon: entry.icon,
            progress:
              gpu?.engineStatus === "available"
                ? gpu.engineUtilizationPercent ?? undefined
                : undefined,
            previewLabel:
              gpu?.engineStatus === "available" &&
              gpu.engineUtilizationPercent !== null
                ? `GPU ${gpu.engineUtilizationPercent.toFixed(0)}%`
                : metricsView.error ?? "GPU 不可用",
          },
        ];
      }
      if (entry.id === "cpu") {
        return [
          {
            id: entry.id,
            label: entry.label,
            symbol: entry.symbol,
            icon: entry.icon,
            progress:
              metricsView.snapshot?.cpuStatus === "available"
                ? metricsView.snapshot.cpuUsagePercent ?? undefined
                : undefined,
            previewLabel: formatCpuSummary(
              metricsView.snapshot,
              metricsView.error,
            ),
          },
        ];
      }
      if (entry.id === "memory") {
        return [
          {
            id: entry.id,
            label: entry.label,
            symbol: entry.symbol,
            icon: entry.icon,
            progress:
              metricsView.snapshot?.memoryStatus === "available"
                ? metricsView.snapshot.memory?.usedPercent
                : undefined,
            previewLabel: formatMemorySummary(
              metricsView.snapshot,
              metricsView.error,
            ),
          },
        ];
      }
      if (entry.id === "media") {
        const currentSession = resolveCurrentMediaSession(mediaView.snapshot);
        const symbol =
          currentSession?.playbackState === "playing"
            ? "Ⅱ"
            : currentSession?.playbackState === "paused"
              ? "▶"
              : "♫";
        return [
          {
            id: entry.id,
            label: entry.label,
            symbol,
            icon: symbol === "Ⅱ" ? "pause" : symbol === "▶" ? "play" : "music",
            previewLabel: formatMediaModuleSummary(mediaView),
            previewContent: <MediaPreviewCard view={mediaView} />,
          },
        ];
      }
      if (entry.id === "codex") {
        return [
          {
            id: entry.id,
            label: entry.label,
            symbol: entry.symbol,
            icon: entry.icon,
            progress: getCodexQuotaProgress(codexQuotaView.quota),
            previewLabel: formatCodexQuotaSummary(codexQuotaView.quota),
          },
        ];
      }
      if (entry.id === "weather") {
        return [
          {
            id: entry.id,
            label: entry.label,
            symbol: settings.weather
              ? weatherView.weather.quality === "unavailable"
                ? "cloud-off"
                : weatherSymbol(weatherView.weather) === "?" && weatherView.weather.snapshot
                  ? "未知"
                  : weatherSymbol(weatherView.weather)
              : entry.symbol,
            icon: settings.weather
              ? weatherView.weather.quality === "unavailable"
                ? "cloud-off"
                : weatherView.weather.snapshot
                  ? resolveWeatherCodeIcon(weatherView.weather.snapshot.current.weatherCode) ?? undefined
                  : "cloud-off"
              : entry.icon,
            previewLabel: settings.weather
              ? formatWeatherSummary(weatherView.weather)
              : "请在设置中填写城市名称",
            previewContent: settings.weather ? (
              <WeatherPreviewCard
                formatTime={formatWeatherTime}
                location={settings.weather}
                state={weatherView.weather}
              />
            ) : undefined,
          },
        ];
      }
      if (entry.id === "clipboard") {
        return [{
          id: entry.id,
          label: entry.label,
          symbol: entry.symbol,
          icon: entry.icon,
          previewLabel: clipboardView.snapshot
            ? `${clipboardView.snapshot.totalEntries} 条历史 · ${clipboardView.snapshot.enabled ? "记录中" : "已关闭"}`
            : "剪贴板历史未读取",
        }];
      }
      return [];
    });

  const persistUpdatedSettings = async (
    next: WidgetSettings,
  ): Promise<boolean> => {
    if (
      !isFixture &&
      settingsRef.current.enabledContentIds.includes("focus") &&
      !next.enabledContentIds.includes("focus")
    ) {
      const timer = timerStoreRef.current?.getSnapshot();
      if (!timer || timer.state === "running" || timer.state === "paused") {
        setSaveFailure(
          timer
            ? "计时仍在运行或暂停中；请先在专注面板点击“重置”，再隐藏该模块。"
            : "计时状态尚未同步；暂不能隐藏专注模块，请稍后重试。",
        );
        setSaveState("failed");
        return false;
      }
    }
    const revision = ++settingsRevision.current;
    settingsRef.current = next;
    setSettings(next);

    if (isFixture) {
      lastSavedSettings.current = next;
      setSaveState("saved");
      setSaveFailure(null);
      return true;
    }

    if (!persistSettings) {
      const failure = settingsLoadFailure ?? "设置保存不可用；原配置已保留。";
      settingsRef.current = lastSavedSettings.current;
      setSettings(lastSavedSettings.current);
      setSaveFailure(failure);
      setSaveState("failed");
      return false;
    }

    setSaveFailure(null);
    setSaveState("saving");
    const operation = settingsWriteQueue.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await persistSettings(next);
          lastSavedSettings.current = next;
          if (revision === settingsRevision.current) {
            setNotice(null);
            setSaveFailure(null);
            setSaveState("saved");
          }
          return true;
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "未知错误";
          if (revision === settingsRevision.current) {
            settingsRef.current = lastSavedSettings.current;
            setSettings(lastSavedSettings.current);
            setSaveFailure(`设置保存失败；原配置仍保留。${message}`);
            setSaveState("failed");
          }
          return false;
        }
      });
    settingsWriteQueue.current = operation.then(() => undefined);
    const saved = await operation;
    return saved && revision === settingsRevision.current;
  };

  const changeSettings = async (next: WidgetSettings): Promise<boolean> => {
    const hiding = next.visibility === "hidden";
    if (hiding) dispatch({ type: "hide" });
    const saved = await persistUpdatedSettings(next);
    if (!saved && hiding) dispatch({ type: "restore" });
    return saved;
  };

  const restoreHiddenWidget = () => {
    const next = { ...settingsRef.current, visibility: "always" as const };
    dispatch({ type: "restore" });
    void persistUpdatedSettings(next).then((saved) => {
      if (!saved) dispatch({ type: "hide" });
    });
  };

  const dispatch = (action: ShellInteractionAction) =>
    setInteraction((current) => reduceShellInteraction(current, action));

  const clearHoverClearTimer = () => {
    // A timer may already have started an asynchronous native cursor query.
    // Invalidate that result as well as cancelling a timer that has not fired.
    hoverClearRevision.current++;
    if (hoverClearTimer.current !== null) {
      window.clearTimeout(hoverClearTimer.current);
      hoverClearTimer.current = null;
    }
  };

  const nativeMode = widgetWindowMode(interaction);
  const windowDimensions = {
    ...widgetDimensions(settings, ringMode),
    popoverSize: popoverSize ?? undefined,
    panelSize: panelSize ?? (nativeMode === "panel" ? PANEL_BOOTSTRAP_SIZE : undefined),
  };
  const nativeGeometryKey = JSON.stringify([
    edge, edgeOffset, nativeMode, windowDimensions.longSide, windowDimensions.thickness,
    popoverSize?.width, popoverSize?.height, panelSize?.width, panelSize?.height,
    nativeMode === "popover" ? popoverIntentRevision : 0,
  ]);
  const geometryRequest = useRef({ key: nativeGeometryKey, edge, edgeOffset, nativeMode, dimensions: windowDimensions });
  geometryRequest.current = { key: nativeGeometryKey, edge, edgeOffset, nativeMode, dimensions: windowDimensions };
  const nativeGeometryReady = isFixture || nativeGeometryReadyKey === nativeGeometryKey;

  useEffect(() => {
    if (isFixture) return;
    let cancelled = false;
    void createWidgetWindowController(
      edge,
      edgeOffset,
      nativeMode,
      windowDimensions,
      (nextEdge, nextOffset) => {
        void closeDragPreviewWindow();
        if (
          nextEdge === settingsRef.current.edge &&
          nextOffset === settingsRef.current.edgeOffset
        )
          return;
        void persistUpdatedSettings({
          ...settingsRef.current,
          edge: nextEdge,
          edgeOffset: nextOffset,
        });
      },
      () => previewEdgeAtCursor(),
    )
      .then((controller) => {
        if (cancelled) controller.dispose();
        else {
          nativeWindow.current = controller;
          const current = geometryRequest.current;
          void controller
            .update(
              current.edge,
              current.edgeOffset,
              current.nativeMode,
              current.dimensions,
            )
            .then(() => {
              if (!cancelled && geometryRequest.current.key === current.key) setNativeGeometryReadyKey(current.key);
            })
            .catch((error: unknown) => {
              console.error(
                "Could not apply the loaded desktop widget settings:",
                error,
              );
            });
        }
      })
      .catch((error: unknown) => {
        console.error("Could not initialize the desktop widget window:", error);
      });
    return () => {
      cancelled = true;
      nativeWindow.current?.dispose();
      nativeWindow.current = null;
      void closeDragPreviewWindow();
    };
    // The native window is initialized once; later state changes use the update effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFixture]);

  useEffect(
    () => () => {
      if (hoverClearTimer.current !== null) {
        window.clearTimeout(hoverClearTimer.current);
        hoverClearTimer.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (isFixture) return;
    let cancelled = false;
    const current = geometryRequest.current;
    void nativeWindow.current
      ?.update(current.edge, current.edgeOffset, current.nativeMode, current.dimensions)
      .then(() => {
        if (!cancelled && geometryRequest.current.key === current.key) setNativeGeometryReadyKey(current.key);
      })
      .catch((error: unknown) => {
        console.error(
          "Could not update desktop widget window geometry:",
          error,
        );
      });
    return () => { cancelled = true; };
  }, [
    edge,
    edgeOffset,
    iconSizeValue,
    isFixture,
    modules.length,
    nativeMode,
    ringMode,
    settings,
    longSideValue,
    thicknessValue,
    nativeGeometryKey,
  ]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const update = () => setStageSize(readStageSize(stage));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    const previous = previousPanelId.current;
    if (interaction.activeModuleId) {
      requestAnimationFrame(() => panelCloseRef.current?.focus());
    } else if (previous) {
      requestAnimationFrame(() => {
        // Focus restoration is accessibility/navigation, not a new hover intent.
        restoringPanelFocus.current = true;
        try { moduleButtonRefs.current.get(previous)?.focus(); }
        finally { restoringPanelFocus.current = false; }
      });
    }
    previousPanelId.current = interaction.activeModuleId;
  }, [interaction.activeModuleId]);

  useEffect(() => {
    const wasOpen = previousSettingsOpen.current;
    if (interaction.settingsOpen) {
      requestAnimationFrame(() => settingsCloseRef.current?.focus());
    } else if (wasOpen && !interaction.hidden) {
      requestAnimationFrame(() => settingsButtonRef.current?.focus());
    }
    previousSettingsOpen.current = interaction.settingsOpen;
  }, [interaction.hidden, interaction.settingsOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (interaction.settingsOpen) {
        event.preventDefault();
        dispatch({ type: "close-settings" });
      } else if (interaction.activeModuleId) {
        event.preventDefault();
        dispatch({ type: "close-panel" });
      } else if (interaction.hoveredModuleId) {
        dispatch({ type: "hover-module", moduleId: null });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [interaction]);

  const layout = isFixture ? calculateShellLayout({
    stageWidth: stageSize.width,
    stageHeight: stageSize.height,
    edge,
    itemCount: modules.length,
    iconSize: iconSizeValue,
    ringMode,
    longSide: longSideValue,
    thickness: thicknessValue,
    rows: settings.rows,
  }) : widgetDimensions(settings, ringMode);

  const visualEdge = dragPosition ? (previewEdge ?? edge) : edge;
  const occupiedAlong = interaction.hidden ? 48 : layout.longSide + 44;
  const edgeAxisLength =
    edge === "top" || edge === "bottom" ? stageSize.width : stageSize.height;
  const edgeTravel = Math.max(0, edgeAxisLength - occupiedAlong);
  const edgePosition = occupiedAlong / 2 + edgeOffset * edgeTravel;
  const dockStyle = {
    "--shell-long-side": `${layout.longSide}px`,
    "--shell-thickness": `${layout.thickness}px`,
    "--shell-hit-size": `${layout.hitSize}px`,
    "--shell-grid-padding": `${layout.gridPadding ?? 8}px`,

    "--shell-dock-opacity": `${settings.dockMaterial === "translucent" ? settings.dockOpacity ?? 100 : settings.dockMaterial === "glass" ? 76 : 100}%`,
    "--shell-dock-blur": `${settings.dockBlur}px`,
    "--shell-strip-length": `${Math.max(14, Math.min(48, Math.round(layout.thickness * 0.3)))}px`,
    "--shell-strip-thickness": `${Math.max(4, Math.min(9, Math.round(layout.thickness * 0.075)))}px`,
    "--shell-icon-size": `${layout.iconSize}px`,
    "--shell-items-per-line": String(layout.itemsPerLine),
    "--shell-line-count": String(layout.lineCount),
    "--shell-edge-position": `${edgePosition}px`,
    "--shell-drag-left": `${dragPosition?.left ?? 0}px`,
    "--shell-drag-top": `${dragPosition?.top ?? 0}px`,
  } as CSSProperties;
  const stageStyle = {
    "--shell-thickness": `${layout.thickness}px`,
    "--shell-panel-gap": `${ACTIVITY_PANEL_GAP}px`,
    "--shell-panel-inset": `${ACTIVITY_PANEL_INSET}px`,
  } as CSSProperties;

  const targetRects = (): ShellDropTarget[] => {
    const stage = stageRef.current;
    if (!stage) return [];
    const stageRect = stage.getBoundingClientRect();
    return EDGES.flatMap((targetEdge) => {
      const target = targetRefs.current.get(targetEdge);
      return target
        ? [
            {
              edge: targetEdge,
              rect: asLocalRect(target.getBoundingClientRect(), stageRect),
            },
          ]
        : [];
    });
  };

  const showPopover = (moduleId: string, button: HTMLButtonElement) => {
    clearHoverClearTimer();
    if (
      restoringPanelFocus.current ||
      interactionRef.current.activeModuleId ||
      interactionRef.current.settingsOpen ||
      interactionRef.current.hidden
    ) {
      return;
    }
    moduleButtonRefs.current.set(moduleId, button);
    // Record intent only. A compact WebView cannot supply preview coordinates.
    setPopoverPosition(null);
    setPopoverIntentRevision((revision) => revision + 1);
    dispatch({ type: "hover-module", moduleId });
  };

  const scheduleHoverClear = () => {
    clearHoverClearTimer();
    if (shouldDeferHoverClearWhilePressed(modulePointerDown.current)) return;
    if (isFixture) {
      dispatch({ type: "hover-module", moduleId: null });
      return;
    }
    const revision = hoverClearRevision.current;
    hoverClearTimer.current = window.setTimeout(() => {
      hoverClearTimer.current = null;
      void nativeHoverTarget()
        .then(({ moduleId }) => {
          if (revision !== hoverClearRevision.current) return;
          if (shouldDeferHoverClearWhilePressed(modulePointerDown.current)) return;
          if (moduleId) {
            const module = modules.find(
              (candidate) => candidate.id === moduleId,
            );
            const button = moduleButtonRefs.current.get(moduleId);
            if (module && button) showPopover(module.id, button);
            return;
          }
          dispatch({ type: "hover-module", moduleId: null });
        })
        .catch((error: unknown) => {
          if (revision !== hoverClearRevision.current) return;
          if (shouldDeferHoverClearWhilePressed(modulePointerDown.current)) return;
          console.error(
            "Could not confirm the native widget hover target:",
            error,
          );
          dispatch({ type: "hover-module", moduleId: null });
        });
    }, 220);
  };

  const beginModulePointerPress = () => {
    modulePointerDown.current = true;
    clearHoverClearTimer();
  };

  const endModulePointerPress = () => {
    if (!modulePointerDown.current) return;
    modulePointerDown.current = false;
    scheduleHoverClear();
  };

  const beginDrag = async (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !dockRef.current || !stageRef.current) return;
    if (!isFixture) {
      event.preventDefault();
      clearHoverClearTimer();
      setPopoverPosition(null);
      dispatch({ type: "hover-module", moduleId: null });
      resetDragPreviewCandidate();
      try {
        await openDragPreviewWindow(null, {
          top: widgetDimensions({ ...settingsRef.current, edge: "top" }, ringMode),
          right: widgetDimensions({ ...settingsRef.current, edge: "right" }, ringMode),
          bottom: widgetDimensions({ ...settingsRef.current, edge: "bottom" }, ringMode),
          left: widgetDimensions({ ...settingsRef.current, edge: "left" }, ringMode),
        });
        await nativeWindow.current?.startDrag();
      } catch (error: unknown) {
        console.error("Could not drag the native widget window:", error);
      } finally {
        await closeDragPreviewWindow();
      }
      return;
    }
    const dockRect = dockRef.current.getBoundingClientRect();
    const stageRect = stageRef.current.getBoundingClientRect();
    dragSession.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - dockRect.left,
      offsetY: event.clientY - dockRect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragPosition({
      left: dockRect.left - stageRect.left,
      top: dockRect.top - stageRect.top,
    });
    setPreviewEdge(edge);
    setPopoverPosition(null);
    dispatch({ type: "hover-module", moduleId: null });
    event.preventDefault();
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const session = dragSession.current;
    const stage = stageRef.current;
    if (!session || !stage || session.pointerId !== event.pointerId) return;
    const point = pointerInStage(event, stage);
    const drop = resolveShellDrop(
      point,
      stageSize,
      targetRects(),
      occupiedAlong,
    );
    if (!drop) {
      setPreviewEdge(null);
      void updateDragPreview(null);
      return;
    }
    const horizontal = drop.edge === "top" || drop.edge === "bottom";
    const position = shellDragPreviewPosition(
      drop,
      point,
      stageSize,
      {
        width: horizontal ? layout.longSide : layout.thickness,
        height: horizontal ? layout.thickness : layout.longSide,
      },
      { x: session.offsetX, y: session.offsetY },
    );
    setDragPosition({ left: position.x, top: position.y });
    setPreviewEdge(drop.edge);
    void updateDragPreview(drop.edge);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const session = dragSession.current;
    const stage = stageRef.current;
    if (!session || !stage || session.pointerId !== event.pointerId) return;
    const drop = resolveShellDrop(
      pointerInStage(event, stage),
      stageSize,
      targetRects(),
      occupiedAlong,
    );
    dragSession.current = null;
    if (drop) {
      void persistUpdatedSettings({
        ...settingsRef.current,
        edge: drop.edge,
        edgeOffset: 0.5,
      });
    }
    setDragPosition(null);
    setPreviewEdge(null);
    void closeDragPreviewWindow();
  };

  const cancelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragSession.current?.pointerId !== event.pointerId) return;
    dragSession.current = null;
    setDragPosition(null);
    setPreviewEdge(null);
    void closeDragPreviewWindow();
  };

  const dockControlProps = {
    onPointerDown: beginDrag,
  };

  const activeModule = modules.find(
    (module) => module.id === interaction.activeModuleId,
  );
  const hoveredModule = modules.find(
    (module) => module.id === interaction.hoveredModuleId,
  );

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const dock = dockRef.current;
    const preview = popoverRef.current;
    const button = hoveredModule && moduleButtonRefs.current.get(hoveredModule.id);
    if (nativeMode !== "popover" || !stage || !dock || !preview || !button || !hoveredModule) return;
    const bounds = preview.getBoundingClientRect();
    const measured = { width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) };
    if (measured.width <= 0 || measured.height <= 0) return;
    if (popoverSize?.width !== measured.width || popoverSize?.height !== measured.height) {
      setPopoverSize(measured);
      return;
    }
    if (!nativeGeometryReady || modulePointerDown.current) return;
    const stageRect = stage.getBoundingClientRect();
    const point = shellPopoverPosition(edge, stageRect,
      asLocalRect(dock.getBoundingClientRect(), stageRect),
      asLocalRect(button.getBoundingClientRect(), stageRect), measured);
    setPopoverPosition((previous) => {
      if (!point) return previous === null ? previous : null;
      if (previous?.moduleId === hoveredModule.id && previous.left === point.x && previous.top === point.y) return previous;
      return { left: point.x, top: point.y, moduleId: hoveredModule.id };
    });
    // Every commit includes resize/content changes; setters are idempotent.
  });

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const panel = stage && typeof stage.querySelector === "function"
      ? stage.querySelector<HTMLElement>(".shell-activity-panel")
      : null;
    if (!panel) {
      if (panelSize !== null) setPanelSize(null);
      return;
    }
    const bounds = panel.getBoundingClientRect();
    const measured = activityPanelSize(bounds, panel);
    if (
      measured.width > 0 &&
      measured.height > 0 &&
      (panelSize?.width !== measured.width || panelSize?.height !== measured.height)
    ) {
      setPanelSize(measured);
    }
  });

  const popoverVisible = nativeMode === "popover" && nativeGeometryReady &&
    popoverPosition?.moduleId === hoveredModule?.id && popoverPosition !== null;

  const closePanel = () => dispatch({ type: "close-panel" });
  const closeSettings = () => dispatch({ type: "close-settings" });
  const openSettings = () => {
    if (isFixture) {
      dispatch({ type: "open-settings" });
      return;
    }
    void toggleSettingsWindow().catch((error: unknown) => {
      setSaveFailure(`无法打开独立设置窗口：${error instanceof Error ? error.message : String(error)}`);
      setSaveState("failed");
    });
  };

  return (
    <main
      ref={stageRef}
      aria-label="桌面摘要"
      className={`shell-stage${isFixture ? "" : " shell-stage-widget"}`}
      data-edge={visualEdge}
      data-hidden={interaction.hidden}
      data-layout-cross={layout.thickness}
      data-layout-long={layout.longSide}
      data-hit-size={layout.hitSize}
      data-icon-size={layout.iconSize}
      data-items-per-line={layout.itemsPerLine}
      data-line-count={layout.lineCount}
      data-ring-mode={ringMode}
      data-visible-modules={modules.length}
      style={stageStyle}
      onPointerCancel={(event) => {
        endModulePointerPress();
        cancelDrag(event);
      }}
      onPointerMove={moveDrag}
      onPointerLeave={scheduleHoverClear}
      onPointerUp={(event) => {
        endModulePointerPress();
        finishDrag(event);
      }}
      onClickCapture={(event) => {
        if (
          isFixture ||
          (event.target instanceof Element &&
            event.target.closest(".shell-control-end"))
        ) {
          return;
        }
        const bounds = settingsButtonRef.current?.getBoundingClientRect();
        if (
          bounds &&
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom
        ) {
          clearHoverClearTimer();
          openSettings();
        }
      }}
    >
      {isFixture ? (
        <div className="shell-stage-label">
          <strong>桌面摘要</strong>
          <span>仅用于 UI 检查；示例状态不代表真实数据。</span>
        </div>
      ) : null}

      <div
        aria-hidden="true"
        className={`shell-edge-targets${dragPosition ? " is-visible" : ""}`}
      >
        {EDGES.map((targetEdge) => (
          <div
            className={`shell-edge-target${previewEdge === targetEdge ? " is-active" : ""}`}
            data-edge={targetEdge}
            key={targetEdge}
            ref={(element) => {
              if (element) targetRefs.current.set(targetEdge, element);
              else targetRefs.current.delete(targetEdge);
            }}
          >
            {EDGE_LABELS[targetEdge]}居中
          </div>
        ))}
      </div>

      {!interaction.hidden ? (
        <section
          ref={dockRef}
          aria-label="模块摘要入口"
          className={`shell-dock${dragPosition ? " is-dragging" : ""}`}
          data-edge={visualEdge}
          data-material={settings.dockMaterial}
          data-ring-mode={ringMode}
          data-offset={edgeOffset}
          style={dockStyle}
        >
          <button
            aria-label="拖动摘要到其他边缘"
            className="shell-control shell-control-start"
            title="拖动停靠栏"
            type="button"
            {...dockControlProps}
          >
            <span aria-hidden="true" className="shell-control-strip" />
            <span aria-hidden="true" className="shell-control-grip">
              <LocalIcon className="shell-control-icon" name="hand" />
            </span>
          </button>
          <button
            aria-label="收起摘要栏"
            className="shell-collapse-toggle"
            onClick={() => void changeSettings({ ...settingsRef.current, visibility: "hidden" })}
            title="收起摘要栏"
            type="button"
          >
            <span aria-hidden="true" />
          </button>
          <div className="shell-dock-surface">
            <div
              aria-label="摘要模块"
              className="shell-module-grid"
              role="group"
            >
              {modules.map((module, moduleIndex) => {
                const progress = clampProgress(module.progress);
                const status = module.previewLabel ?? "模块尚未接入实际状态";
                const iconName = module.icon ?? resolveSummaryIcon(
                  module.id,
                  module.symbol,
                  module.symbolVariant,
                );
                const symbolClass =
                  module.symbolVariant === "readout"
                    ? "shell-symbol shell-symbol-readout"
                    : module.symbol === "CPU" || module.symbol === "GPU"
                      ? "shell-symbol shell-symbol-wordmark"
                      : "shell-symbol";

                return (
                  <button
                    aria-label={
                      module.accessibleLabel ??
                      `${module.label}模块，${status}，打开活动面板`
                    }
                    className="shell-module-hit-area"
                    data-module-id={module.id}
                    style={shellModuleGridPosition(moduleIndex, modules.length, layout.lineCount, layout.horizontal)}
                    key={module.id}
                    onBlur={scheduleHoverClear}
                    onClick={() =>
                      dispatch({ type: "open-panel", moduleId: module.id })
                    }
                    onFocus={(event) =>
                      showPopover(module.id, event.currentTarget)
                    }
                    onPointerEnter={(event) =>
                      showPopover(module.id, event.currentTarget)
                    }
                    onPointerDown={beginModulePointerPress}
                    onPointerUp={endModulePointerPress}
                    onPointerCancel={endModulePointerPress}
                    onPointerLeave={scheduleHoverClear}
                    ref={(element) => {
                      if (element)
                        moduleButtonRefs.current.set(module.id, element);
                      else moduleButtonRefs.current.delete(module.id);
                    }}
                    type="button"
                  >
                    <span
                      className="shell-module-orbit"
                      data-has-progress={progress !== undefined}
                      style={
                        progress === undefined
                          ? undefined
                          : ({
                              "--shell-ring-progress": `${progress}%`,
                            } as CSSProperties)
                      }
                    >
                      {iconName ? (
                        <LocalIcon className={`${symbolClass} shell-symbol-icon`} name={iconName} />
                      ) : (
                        <span aria-hidden="true" className={symbolClass}>{module.symbol}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <button
            aria-expanded={interaction.settingsOpen}
            aria-label="打开停靠设置"
            className="shell-control shell-control-end"
            onClick={() => {
              clearHoverClearTimer();
              openSettings();
            }}
            onFocus={clearHoverClearTimer}
            onPointerEnter={clearHoverClearTimer}
            onPointerLeave={scheduleHoverClear}
            ref={settingsButtonRef}
            type="button"
          >
            <span aria-hidden="true" className="shell-control-strip" />
            <span aria-hidden="true" className="shell-control-gear">
              <LocalIcon className="shell-control-icon" name="settings" />
            </span>
          </button>
        </section>
      ) : (
        <button
          aria-label="恢复摘要栏"
          className={`shell-restore-strip edge-${edge}`}
          onClick={restoreHiddenWidget}
          style={
            {
              "--shell-edge-position": `${edgePosition}px`,
              "--shell-strip-length": `${Math.max(14, Math.min(48, Math.round(layout.thickness * 0.3)))}px`,
              "--shell-strip-thickness": `${Math.max(4, Math.min(9, Math.round(layout.thickness * 0.075)))}px`,
            } as CSSProperties
          }
          type="button"
        >
          <span aria-hidden="true" />
        </button>
      )}

      {saveFailure && !interaction.settingsOpen && !isFixture ? (
        <div
          aria-live="assertive"
          className="shell-settings-save-alert"
          role="alert"
        >
          {saveFailure}
        </div>
      ) : null}

      {hoveredModule && nativeMode === "popover" ? (
        <div
          ref={popoverRef}
          aria-hidden={!popoverVisible}
          aria-label={`${hoveredModule.label}概况`}
          className="shell-popover"
          role="tooltip"
          style={
            {
              left: `${popoverPosition?.left ?? 0}px`,
              top: `${popoverPosition?.top ?? 0}px`,
              visibility: popoverVisible ? "visible" : "hidden",
              width: `${Math.max(1, Math.min(POPOVER_WIDTH, (typeof window === "undefined" ? stageSize.width : window.screen?.availWidth ?? stageSize.width) - 2 * POPOVER_INSET))}px`,
            } as CSSProperties
          }
        >
          <strong>{hoveredModule.label}</strong>
          {hoveredModule.progress !== undefined ? (
            <div aria-label={`${hoveredModule.label}已用进度`} className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hoveredModule.progress)}>
              <span style={{ width: `${Math.max(0, Math.min(100, hoveredModule.progress))}%` }} />
            </div>
          ) : null}
          {hoveredModule.previewContent ? (
            <div className="shell-popover-content">{hoveredModule.previewContent}</div>
          ) : (
            <p>{hoveredModule.previewLabel ?? "该模块尚未接入实际状态。"}</p>
          )}
          <span>单击图标打开活动面板</span>
        </div>
      ) : null}

      {activeModule?.id === "todo" ? (
        <section
          aria-label="待办活动面板"
          className={`shell-activity-panel edge-${edge}`}
          role="dialog"
        >
          <TodoPanel
            draft={todoDraft}
            onDraftChange={setTodoDraft}
            closeButtonRef={panelCloseRef}
            isFixture={isFixture}
            snapshotError={todoFailure}
            snapshotSyncStatus={todoSyncStatus}
            store={todoStoreRef.current!}
            onClose={closePanel}
          />
        </section>
      ) : activeModule?.id === "focus" ? (
        <section
          aria-label="计时活动面板"
          className={`shell-activity-panel edge-${edge}`}
          role="dialog"
        >
          <TimerPanel
            closeButtonRef={panelCloseRef}
            isFixture={isFixture}
            onClose={closePanel}
          />
        </section>
      ) : activeModule?.id === "codex" ? (
        <section
          aria-label="Codex额度活动面板"
          className={`shell-activity-panel edge-${edge}`}
          role="dialog"
        >
          <CodexPanel
            closeButtonRef={panelCloseRef}
            isRefreshing={codexQuotaView.isRefreshing}
            onClose={closePanel}
            state={codexQuotaView.quota}
          />
        </section>
      ) : activeModule?.id === "weather" ? (
        <section
          aria-label="天气活动面板"
          className={`shell-activity-panel edge-${edge}`}
          role="dialog"
        >
          <WeatherPanel
            closeButtonRef={panelCloseRef}
            isRefreshing={weatherView.isRefreshing}
            location={settings.weather}
            onClose={closePanel}
            state={weatherView.weather}
          />
        </section>
      ) : activeModule?.id === "clipboard" ? (
        <section
          aria-label="剪贴板历史活动面板"
          className={`shell-activity-panel edge-${edge}`}
          role="dialog"
        >
          <ClipboardPanel
            closeButtonRef={panelCloseRef}
            onClose={closePanel}
            store={clipboardStoreRef.current!}
          />
        </section>
      ) : activeModule?.id === "media" && !isFixture ? (
        <section
          aria-label="媒体活动面板"
          className={`shell-activity-panel edge-${edge} media-activity-panel`}
          role="dialog"
        >
          <MediaPanel
            closeButtonRef={panelCloseRef}
            now={Date.now()}
            store={mediaStoreRef.current!}
            view={mediaView}
            onClose={closePanel}
          />
        </section>
      ) :
      !isFixture &&
      activeModule &&
      (activeModule.id === "cpu" || activeModule.id === "gpu" || activeModule.id === "memory") ? (
        <section
          aria-label={`${activeModule.label}活动面板`}
          className={`shell-activity-panel edge-${edge}`}
          role="dialog"
        >
          <MetricsPanel
            closeButtonRef={panelCloseRef}
            moduleId={activeModule.id}
            onClose={closePanel}
            state={metricsView}
          />
        </section>
      ) : activeModule ? (
        <section
          aria-label={`${activeModule.label}活动面板`}
          className={`shell-activity-panel edge-${edge}`}
          role="dialog"
        >
          <header>
            <div>
              <span>活动面板</span>
              <h1>{activeModule.label}</h1>
            </div>
            <button
              aria-label="关闭详情"
              className="shell-panel-close"
              onClick={closePanel}
              ref={panelCloseRef}
              type="button"
            >
              <LocalIcon className="shell-panel-close-icon" name="x" />
            </button>
          </header>
          <p>
            {activeModule.previewLabel
              ? `隔离 UI 样例：${activeModule.previewLabel}`
              : "此模块尚未接入真实状态；当前没有可显示的数据。"}
          </p>
          <footer>
            <span aria-hidden="true" />按 Esc 或返回按钮回到摘要
          </footer>
        </section>
      ) : null}

      {interaction.settingsOpen ? (
        <SettingsPanel
          closeButtonRef={settingsCloseRef}
          layout={layout}
          notice={notice}
          onChange={changeSettings}
          onClose={closeSettings}
          saveFailure={saveFailure}
          saveState={saveState}
          settings={settings}
        />
      ) : null}
    </main>
  );
}
