import {
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
  primaryMonitor,
  type Monitor,
} from "@tauri-apps/api/window";
import { computeDockGeometry, resolveMonitor, type DockEdge, type MonitorCandidate } from "./geometry";
import { reduceShellState, type ShellAction, type ShellState } from "./panel-state";
import "./style.css";

const SUMMARY_SIZE = new LogicalSize(292, 72);
const INPUT_SIZE = new LogicalSize(360, 350);
const appWindow = getCurrentWindow();

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing shell element: ${selector}`);
  }
  return element;
}

const openButton = requiredElement<HTMLButtonElement>("#open-panel");
const closeButton = requiredElement<HTMLButtonElement>("#close-panel");
const panel = requiredElement<HTMLElement>("#panel");
const draftInput = requiredElement<HTMLInputElement>("#draft");
const monitorSelect = requiredElement<HTMLSelectElement>("#monitor-select");
const ratioSlider = requiredElement<HTMLInputElement>("#edge-ratio");
const ratioValue = requiredElement<HTMLElement>("#ratio-value");
const locationStatus = requiredElement<HTMLElement>("#location-status");
const edgeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-edge]"));

let state: ShellState = { panel: "summary", draft: "" };
let selectedEdge: DockEdge = "top";
let selectedRatio = 0.5;
let preferredMonitorId: string | null = null;
let monitorCandidates: MonitorCandidate<Monitor>[] = [];
let topologyRefreshPromise: Promise<void> | null = null;
let windowSyncPromise: Promise<void> | null = null;
let windowSyncQueued = false;
let focusInputQueued = false;

function monitorId(monitor: Monitor): string {
  return (monitor.name ?? "Unnamed display") + "@" + monitor.position.x + "," + monitor.position.y;
}

function monitorLabel(monitor: Monitor, primary: boolean): string {
  const name = monitor.name ?? "Unnamed display";
  const suffix = primary ? " (primary)" : "";
  return name + " · " + monitor.workArea.size.width + "×" + monitor.workArea.size.height + suffix;
}

function renderMonitorOptions(activeMonitor: Monitor | null, usedFallback: boolean): void {
  monitorSelect.replaceChildren();

  const selectedIsAvailable = monitorCandidates.some((candidate) => candidate.id === preferredMonitorId);
  if (preferredMonitorId && !selectedIsAvailable) {
    const missing = new Option("Preferred display disconnected · using fallback", preferredMonitorId);
    missing.disabled = true;
    monitorSelect.add(missing);
  }

  monitorCandidates.forEach((candidate, index) => {
    const option = new Option(
      monitorLabel(candidate.value, candidate.primary),
      candidate.id,
    );
    monitorSelect.add(option);
  });

  monitorSelect.disabled = monitorCandidates.length === 0;
  monitorSelect.value = preferredMonitorId ?? (activeMonitor ? monitorId(activeMonitor) : "");

  if (!activeMonitor) {
    locationStatus.textContent = "No display is available; the last window position is unchanged.";
  } else if (usedFallback) {
    locationStatus.textContent = "Preferred display is unavailable; using " + monitorLabel(activeMonitor, true) + ".";
  } else {
    locationStatus.textContent = "Position follows the selected display work area.";
  }
}

async function applyWindowGeometry(): Promise<void> {
  const resolution = resolveMonitor(preferredMonitorId, monitorCandidates);
  const candidate = resolution.monitor;
  renderMonitorOptions(candidate?.value ?? null, resolution.usedFallback);
  if (!candidate) {
    return;
  }

  const monitor = candidate.value;
  const logicalSize = state.panel === "input" ? INPUT_SIZE : SUMMARY_SIZE;
  await appWindow.setSize(
    new PhysicalSize(
      Math.round(logicalSize.width * monitor.scaleFactor),
      Math.round(logicalSize.height * monitor.scaleFactor),
    ),
  );
  const [inner, outer] = await Promise.all([appWindow.innerSize(), appWindow.outerSize()]);
  const geometry = computeDockGeometry(
    {
      x: monitor.workArea.position.x,
      y: monitor.workArea.position.y,
      width: monitor.workArea.size.width,
      height: monitor.workArea.size.height,
    },
    selectedEdge,
    selectedRatio,
    { width: logicalSize.width, height: logicalSize.height },
    monitor.scaleFactor,
    {
      width: Math.max(0, outer.width - inner.width),
      height: Math.max(0, outer.height - inner.height),
    },
  );

  if (inner.width !== geometry.size.width || inner.height !== geometry.size.height) {
    await appWindow.setSize(new PhysicalSize(geometry.size.width, geometry.size.height));
  }
  await appWindow.setPosition(new PhysicalPosition(geometry.position.x, geometry.position.y));
}

async function refreshMonitorTopology(): Promise<void> {
  if (topologyRefreshPromise) {
    return topologyRefreshPromise;
  }

  topologyRefreshPromise = (async () => {
    const [available, primary, current] = await Promise.all([
      availableMonitors(),
      primaryMonitor(),
      currentMonitor(),
    ]);
    const primaryId = primary ? monitorId(primary) : null;
    monitorCandidates = available.map((monitor) => ({
      id: monitorId(monitor),
      primary: monitorId(monitor) === primaryId,
      value: monitor,
    }));

    if (preferredMonitorId === null) {
      const currentId = current ? monitorId(current) : primaryId;
      preferredMonitorId =
        monitorCandidates.find((candidate) => candidate.id === currentId)?.id ??
        monitorCandidates.find((candidate) => candidate.primary)?.id ??
        monitorCandidates[0]?.id ??
        null;
    }

    await applyWindowGeometry();
  })()
    .catch((error: unknown) => {
      locationStatus.textContent = "Display positioning is unavailable: " + String(error);
      monitorSelect.disabled = true;
    })
    .finally(() => {
      topologyRefreshPromise = null;
    });
  return topologyRefreshPromise;
}

function requestWindowSync(focusInput = false): Promise<void> {
  windowSyncQueued = true;
  focusInputQueued ||= focusInput;
  if (windowSyncPromise) {
    return windowSyncPromise;
  }

  windowSyncPromise = (async () => {
    while (windowSyncQueued) {
      windowSyncQueued = false;
      const panelToApply = state.panel;
      if (monitorCandidates.length === 0) {
        await refreshMonitorTopology();
      } else {
        await applyWindowGeometry();
      }

      if (panelToApply === state.panel) {
        if (panelToApply === "input" && focusInputQueued) {
          focusInputQueued = false;
          await appWindow.setFocus();
          draftInput.focus();
        } else if (panelToApply === "summary") {
          focusInputQueued = false;
          openButton.focus();
        }
      } else {
        windowSyncQueued = true;
      }
    }
  })().finally(() => {
    windowSyncPromise = null;
    if (windowSyncQueued) {
      void requestWindowSync();
    }
  });
  return windowSyncPromise;
}

function renderPanelState(): void {
  const isInputOpen = state.panel === "input";
  panel.hidden = !isInputOpen;
  openButton.setAttribute("aria-expanded", String(isInputOpen));
  openButton.textContent = isInputOpen ? "Hide" : "Open";
  draftInput.value = state.draft;
}

async function dispatch(action: ShellAction): Promise<void> {
  state = reduceShellState(state, action);
  renderPanelState();
  await requestWindowSync(action.type === "toggle-input" && state.panel === "input");
}

openButton.addEventListener("click", () => {
  void dispatch({ type: "toggle-input" });
});

closeButton.addEventListener("click", () => {
  void dispatch({ type: "close-input" });
});

edgeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const edge = button.dataset.edge as DockEdge | undefined;
    if (!edge) {
      return;
    }
    selectedEdge = edge;
    edgeButtons.forEach((candidate) => {
      candidate.setAttribute("aria-pressed", String(candidate === button));
    });
    void requestWindowSync();
  });
});

ratioSlider.addEventListener("input", () => {
  selectedRatio = Number(ratioSlider.value) / 100;
  ratioValue.textContent = ratioSlider.value + "%";
  void requestWindowSync();
});

monitorSelect.addEventListener("change", () => {
  preferredMonitorId = monitorSelect.value || null;
  void requestWindowSync();
});

draftInput.addEventListener("input", () => {
  state = reduceShellState(state, { type: "edit-draft", value: draftInput.value });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.panel === "input") {
    event.preventDefault();
    void dispatch({ type: "close-input" });
  }
});

void refreshMonitorTopology();
void appWindow.onMoved(() => {
  void refreshMonitorTopology();
});
void appWindow.onScaleChanged(() => {
  void refreshMonitorTopology();
});
void appWindow.onFocusChanged(({ payload: focused }) => {
  if (focused) {
    void refreshMonitorTopology();
  }
});
