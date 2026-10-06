import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TodoBridge, TodoChangedEvent, TodoSnapshot } from "./todo-store";

export const TODO_CHANGED_EVENT = "todo://changed";

export const todoBridge: TodoBridge = {
  listen: (handler: (event: TodoChangedEvent) => void) =>
    listen<TodoSnapshot>(TODO_CHANGED_EVENT, ({ payload }) => handler({ snapshot: payload })),
  snapshot: () => invoke<TodoSnapshot>("todo_get_snapshot"),
  add: (actionId, text) => invoke<TodoSnapshot>("todo_add", { actionId, text }),
  setCompleted: (actionId, id, completed) =>
    invoke<TodoSnapshot>("todo_set_completed", { actionId, id, completed }),
  delete: (actionId, id) => invoke<TodoSnapshot>("todo_delete", { actionId, id }),
  reorder: (actionId, orderedIds) => invoke<TodoSnapshot>("todo_reorder", { actionId, orderedIds }),
};
