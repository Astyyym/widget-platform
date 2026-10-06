import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { LocalIcon } from "../../shell/LocalIcon";
import { todoBridge } from "./todo-bridge";
import {
  parseTodoError,
  TodoSnapshotStore,
  type TodoError,
  type TodoItem,
  type TodoSyncStatus,
} from "./todo-store";
import "./todo-panel.css";

type TodoPanelProps = {
  draft: string;
  onDraftChange: Dispatch<SetStateAction<string>>;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  isFixture?: boolean;
  snapshotError: TodoError | null;
  snapshotSyncStatus: TodoSyncStatus;
  store: TodoSnapshotStore;
};

function actionId(prefix: string): string {
  return `todo-ui-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type TodoDragSession = {
  sourceId: string;
  pointerId: number | null;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

type TodoDragVisual = TodoDragSession & { left: number; top: number };

function clientPoint(event: MouseEvent): { x: number; y: number } {
  return {
    x: event.clientX,
    y: event.clientY,
  };
}

function scrollListForPointer(list: HTMLOListElement, clientY: number): void {
  const bounds = list.getBoundingClientRect();
  const edgeDistance = 34;
  if (clientY < bounds.top + edgeDistance) {
    list.scrollTop -= Math.max(6, Math.round((bounds.top + edgeDistance - clientY) / 2));
  } else if (clientY > bounds.bottom - edgeDistance) {
    list.scrollTop += Math.max(6, Math.round((clientY - (bounds.bottom - edgeDistance)) / 2));
  }
}

export function TodoPanel({
  draft,
  onDraftChange: setDraft,
  closeButtonRef,
  onClose,
  isFixture = false,
  snapshotError,
  snapshotSyncStatus,
  store,
}: TodoPanelProps) {
  const [snapshot, setSnapshot] = useState(() => store.getSnapshot());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<TodoError | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const dragMouse = useRef<TodoDragSession | null>(null);
  const dragFrame = useRef<number | null>(null);
  const pendingDragVisual = useRef<TodoDragVisual | null>(null);
  const reorderRef = useRef<(fromId: string, toId: string) => void>(() => undefined);
  const busyRef = useRef(busy);
  const fixtureRef = useRef(isFixture);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dragVisual, setDragVisual] = useState<TodoDragVisual | null>(null);

  busyRef.current = busy;
  fixtureRef.current = isFixture;

  useEffect(() => {
    if (isFixture) return;
    const unsubscribe = store.subscribe(() => setSnapshot(store.getSnapshot()));
    setSnapshot(store.getSnapshot());
    return unsubscribe;
  }, [isFixture, store]);

 const items = snapshot?.items ?? [];
  const draggedItem = dragVisual
    ? items.find((item) => item.id === dragVisual.sourceId)
    : null;

  const runMutation = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setFailure(null);
    try {
      store.acceptCommandSnapshot(await operation());
      setSnapshot(store.getSnapshot());
      return true;
    } catch (error: unknown) {
      setFailure(parseTodoError(error));
      setSnapshot(store.getSnapshot());
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addTodo = async () => {
    const text = draft.trim();
    if (!text || busy || isFixture) return;
    const saved = await runMutation(() => todoBridge.add(actionId("add"), text));
    if (saved) setDraft((current) => current === draft ? "" : current);
  };

  const toggleTodo = (item: TodoItem) => {
    if (busy || isFixture) return;
    void runMutation(() => todoBridge.setCompleted(actionId("complete"), item.id, !item.completed));
  };

  const deleteTodo = (item: TodoItem) => {
    if (busy || isFixture) return;
    void runMutation(() => todoBridge.delete(actionId("delete"), item.id));
  };

  const reorder = (fromId: string, toId: string) => {
    if (busy || isFixture || fromId === toId || !snapshot) return;
    const currentIds = snapshot.items.map((item) => item.id);
    const fromIndex = currentIds.indexOf(fromId);
    const toIndex = currentIds.indexOf(toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const nextIds = [...currentIds];
    nextIds.splice(fromIndex, 1);
    nextIds.splice(toIndex, 0, fromId);
    void runMutation(() => todoBridge.reorder(actionId("reorder"), nextIds));
  };

  reorderRef.current = reorder;
  const displayedFailure = failure ?? snapshotError;
  const freshnessMessage = snapshot
    ? snapshotSyncStatus === "syncing"
      ? "正在同步；当前内容为上次已保存状态。"
      : snapshotSyncStatus === "failed"
        ? "同步失败；当前内容为上次已保存状态。"
        : snapshotSyncStatus === "idle"
          ? "暂未连接；当前内容为上次已保存状态。"
          : null
    : null;

  const beginDrag = (
    target: HTMLButtonElement,
    sourceId: string,
    clientX: number,
    clientY: number,
    pointerId: number | null,
    preventDefault: () => void,
  ) => {
    const list = listRef.current;
    if (
      busyRef.current ||
      fixtureRef.current ||
      !list ||
      !list.contains(target)
    ) return;
    const item = target.closest<HTMLElement>("[data-todo-id]");
    if (item?.dataset.todoId !== sourceId) return;
    const itemBounds = item.getBoundingClientRect();
    const session: TodoDragSession = {
      sourceId,
      pointerId,
      offsetX: clientX - itemBounds.left,
      offsetY: clientY - itemBounds.top,
      width: itemBounds.width,
      height: itemBounds.height,
    };
    dragMouse.current = session;
    setDragVisual({ ...session, left: itemBounds.left, top: itemBounds.top });
    setDraggedId(sourceId);
    setDropTargetId(sourceId);
    if (pointerId !== null) {
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // Window-level listeners continue tracking if capture is unavailable.
      }
    }
    preventDefault();
  };

  const beginPointerDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    sourceId: string,
  ) => {
    if (
      event.button !== 0 ||
      !event.isPrimary
    ) return;
    beginDrag(
      event.currentTarget,
      sourceId,
      event.clientX,
      event.clientY,
      event.pointerId,
      () => event.preventDefault(),
    );
  };

  const beginMouseDrag = (event: ReactMouseEvent<HTMLButtonElement>, sourceId: string) => {
    if (event.button !== 0 || dragMouse.current) return;
    beginDrag(
      event.currentTarget,
      sourceId,
      event.clientX,
      event.clientY,
      null,
      () => event.preventDefault(),
    );
  };

  const moveByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const target = event.key === "ArrowUp" ? index - 1 : index + 1;
    if (target < 0 || target >= items.length) return;
    reorder(items[index].id, items[target].id);
  };

  /* Keep the drag session at window level so WebView retargeting cannot lose it. */
  useEffect(() => {
    const scheduleVisual = (visual: TodoDragVisual) => {
      pendingDragVisual.current = visual;
      if (dragFrame.current !== null) return;
      dragFrame.current = window.requestAnimationFrame(() => {
        dragFrame.current = null;
        const latest = pendingDragVisual.current;
        pendingDragVisual.current = null;
        if (dragMouse.current && latest) setDragVisual(latest);
      });
    };
    const moveDragAt = (session: TodoDragSession, x: number, y: number) => {
      const list = listRef.current;
      if (!list) return;
      scrollListForPointer(list, y);
      const target = document.elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-todo-id]");
      const targetId = target?.dataset.todoId ?? null;
      setDropTargetId((current) => current === targetId ? current : targetId);
      scheduleVisual({
        ...session,
        left: x - session.offsetX,
        top: y - session.offsetY,
      });
    };
    const handlePointerMove = (event: PointerEvent) => {
      const session = dragMouse.current;
      if (!session || session.pointerId !== event.pointerId) return;
      const point = clientPoint(event);
      moveDragAt(session, point.x, point.y);
    };
    const handleMouseMove = (event: MouseEvent) => {
      const session = dragMouse.current;
      if (!session || session.pointerId !== null) return;
      moveDragAt(session, event.clientX, event.clientY);
    };
    const finishDrag = (session: TodoDragSession, clientX: number, clientY: number) => {
      const target = document.elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>("[data-todo-id]");
      dragMouse.current = null;
      pendingDragVisual.current = null;
      if (dragFrame.current !== null) {
        window.cancelAnimationFrame(dragFrame.current);
        dragFrame.current = null;
      }
      setDraggedId(null);
      setDropTargetId(null);
      setDragVisual(null);
      if (target?.dataset.todoId) reorderRef.current(session.sourceId, target.dataset.todoId);
    };
    const handlePointerUp = (event: PointerEvent) => {
      const session = dragMouse.current;
      if (!session || session.pointerId !== event.pointerId) return;
      finishDrag(session, event.clientX, event.clientY);
    };
    const handleMouseUp = (event: MouseEvent) => {
      const session = dragMouse.current;
      if (!session || session.pointerId !== null) return;
      finishDrag(session, event.clientX, event.clientY);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      if (dragMouse.current?.pointerId !== event.pointerId) return;
      dragMouse.current = null;
      pendingDragVisual.current = null;
      if (dragFrame.current !== null) {
        window.cancelAnimationFrame(dragFrame.current);
        dragFrame.current = null;
      }
      setDraggedId(null);
      setDropTargetId(null);
      setDragVisual(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      if (dragFrame.current !== null) window.cancelAnimationFrame(dragFrame.current);
      pendingDragVisual.current = null;
      dragMouse.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, []);

  if (isFixture) {
    return (
      <section className="todo-panel" aria-label="待办活动面板" role="dialog">
        <TodoPanelHeader closeButtonRef={closeButtonRef} onClose={onClose} />
        <p className="todo-panel-copy">隔离 UI 样例：待办列表、完成状态和优先级操作。</p>
      </section>
    );
  }

  return (
    <section aria-label="待办活动面板" className="todo-panel" role="dialog">
      <TodoPanelHeader closeButtonRef={closeButtonRef} onClose={onClose} />
      <form
        className="todo-add-form"
        onSubmit={(event) => {
          event.preventDefault();
          void addTodo();
        }}
      >
        <input
          aria-label="新待办内容"
          autoComplete="off"
          maxLength={2000}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="添加待办"
          value={draft}
        />
        <button disabled={busy || !draft.trim()} type="submit">添加</button>
      </form>
      {displayedFailure ? (
        <p aria-live="assertive" className="todo-error" role="alert">
          {displayedFailure.message}
        </p>
      ) : null}
      {freshnessMessage ? (
        <p className="todo-sync-status" role="status">
          {freshnessMessage}
        </p>
      ) : null}
      {snapshot ? (
          <div
            className="todo-list-viewport"
            onWheelCapture={(event) => {
              const list = listRef.current;
              if (!list) return;
              const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
                ? 16
                : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                  ? list.clientHeight
                  : 1;
              const delta = event.deltaY * multiplier;
              if (!Number.isFinite(delta) || delta === 0) return;
              const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
              const nextScrollTop = Math.min(
                maxScrollTop,
                Math.max(0, list.scrollTop + delta),
              );
              if (nextScrollTop === list.scrollTop) return;
              event.preventDefault();
              event.stopPropagation();
              list.scrollTop = nextScrollTop;
            }}
          >
            <ol
              aria-label={draggedId ? `待办列表，正在调整${draggedId}` : "待办列表"}
              className="todo-list"
              ref={listRef}
            >
              {items.map((item, index) => (
                <li
                  className={`${draggedId === item.id ? "is-dragged" : ""}${dropTargetId === item.id && draggedId !== item.id ? " is-drop-target" : ""}`}
                  data-todo-id={item.id}
                  key={item.id}
                >
                  <button
                    aria-label={`拖动待办：${item.text}；使用上下箭头调整顺序`}
                    className="todo-drag-handle"
                    onKeyDown={(event) => moveByKeyboard(event, index)}
                    onMouseDown={(event) => beginMouseDrag(event, item.id)}
                    onPointerDown={(event) => beginPointerDrag(event, item.id)}
                    title="拖动调整优先级"
                    type="button"
                  >
                    <LocalIcon name="grip-vertical" size={16} />
                  </button>
                  <button
                    aria-checked={item.completed}
                    aria-label={`${item.completed ? "取消完成" : "完成"}：${item.text}`}
                    className={`todo-check${item.completed ? " is-completed" : ""}`}
                    onClick={() => toggleTodo(item)}
                    role="checkbox"
                    type="button"
                  >
                    <LocalIcon name={item.completed ? "check" : "circle"} size={20} />
                  </button>
                  <span className={item.completed ? "todo-text is-completed" : "todo-text"}>{item.text}</span>
                  <button aria-label={`删除：${item.text}`} className="todo-delete" onClick={() => deleteTodo(item)} type="button"><LocalIcon name="trash-2" size={16} /></button>
                </li>
              ))}
            </ol>
          </div>
      ) : displayedFailure ? (
        <p className="todo-panel-copy">待办数据暂不可用。</p>
      ) : (
        <p className="todo-panel-copy">正在读取待办…</p>
      )}
      {snapshot && items.length === 0 ? <p className="todo-empty">还没有待办。</p> : null}
      <footer className="todo-panel-footer">
        <span aria-hidden="true" />
        {snapshot
          ? `已保存 ${items.length} 项 · 修订 ${snapshot.revision}`
          : displayedFailure
            ? "无法同步"
            : "正在同步"}
      </footer>
      {dragVisual && draggedItem
        ? createPortal(
            <div
              aria-hidden="true"
              className="todo-drag-ghost"
              style={{
                height: `${dragVisual.height}px`,
                left: `${dragVisual.left}px`,
                top: `${dragVisual.top}px`,
                width: `${dragVisual.width}px`,
              }}
            >
              <span className="todo-drag-ghost-grip"><LocalIcon name="grip-vertical" size={16} /></span>
              <span className={`todo-drag-ghost-check${draggedItem.completed ? " is-completed" : ""}`}>
                <LocalIcon name={draggedItem.completed ? "check" : "circle"} size={20} />
              </span>
              <span className="todo-drag-ghost-text">{draggedItem.text}</span>
              <span className="todo-drag-ghost-delete"><LocalIcon name="trash-2" size={16} /></span>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}

function TodoPanelHeader({ closeButtonRef, onClose }: Pick<TodoPanelProps, "closeButtonRef" | "onClose">) {
  return (
    <header>
      <div>
        <span>活动面板</span>
        <h1>待办</h1>
      </div>
      <button aria-label="关闭详情" className="shell-panel-close" onClick={onClose} ref={closeButtonRef} type="button"><LocalIcon name="x" size={16} /></button>
    </header>
  );
}
