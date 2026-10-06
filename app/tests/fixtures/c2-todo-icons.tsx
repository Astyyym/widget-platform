import { createRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { TodoPanel } from "../../src/features/todo/TodoPanel";
import { todoBridge } from "../../src/features/todo/todo-bridge";
import { TodoSnapshotStore, type TodoSnapshot } from "../../src/features/todo/todo-store";
import "../../src/styles.css";
import "../../src/shell/shell-frame.css";

// E1 only: real panel component, synthetic store and in-memory commands.
// No ShellFrame mount, Tauri listener, native database or private data access.
const store = new TodoSnapshotStore();
const calls: string[] = [];
function snapshot(): TodoSnapshot {
  return structuredClone(store.getSnapshot()!);
}
function mutate(operation: string, update: (next: TodoSnapshot) => void): TodoSnapshot {
  calls.push(operation);
  const next = snapshot();
  next.revision += 1;
  update(next);
  store.acceptCommandSnapshot(next);
  return next;
}
Object.assign(todoBridge, {
  listen: async () => () => undefined,
  snapshot: async () => snapshot(),
  add: async (_action: string, text: string) => mutate("add", (next) => {
    next.items.push({ id: `added-${next.revision}`, text, completed: false, createdAt: 0, updatedAt: 0, priorityOrder: next.items.length });
  }),
  setCompleted: async (_action: string, id: string, completed: boolean) => mutate("complete", (next) => {
    next.items.find((item) => item.id === id)!.completed = completed;
  }),
  delete: async (_action: string, id: string) => mutate("delete", (next) => {
    next.items = next.items.filter((item) => item.id !== id);
  }),
  reorder: async (_action: string, ids: string[]) => mutate("reorder", (next) => {
    next.items = ids.map((id, priorityOrder) => ({ ...next.items.find((item) => item.id === id)!, priorityOrder }));
  }),
});

function Fixture() {
  const [closed, setClosed] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <main className="shell-stage">
      {closed ? <p role="status">已返回摘要（隔离样例）</p> : (
        <div className="shell-activity-panel edge-top">
          <TodoPanel closeButtonRef={createRef<HTMLButtonElement>()} onClose={() => setClosed(true)}
            draft={draft} onDraftChange={setDraft}
            snapshotError={null} snapshotSyncStatus="ready" store={store} />
        </div>
      )}
    </main>
  );
}
const root = createRoot(document.getElementById("root")!);
let generation = 0;
function reset() {
  store.acceptCommandSnapshot({
    schemaVersion: 1, revision: 1, instanceId: `fixture-${++generation}`,
    items: [
      { id: "first", text: "整理待办笔记：检查窄屏下的中文长文本与图标布局，保留完整操作名称。", completed: false, createdAt: 0, updatedAt: 0, priorityOrder: 0 },
      { id: "second", text: "已完成的合成样例", completed: true, createdAt: 0, updatedAt: 0, priorityOrder: 1 },
    ],
  });
  calls.length = 0;
  flushSync(() => root.render(<Fixture key={generation} />));
}
declare global {
  interface Window {
    __resetTodoIcons: typeof reset;
    __todoIconState: () => { snapshot: TodoSnapshot; calls: string[] };
  }
}
window.__resetTodoIcons = reset;
window.__todoIconState = () => ({ snapshot: snapshot(), calls: [...calls] });
reset();
