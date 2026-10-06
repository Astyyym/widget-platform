import type { TimerSnapshot } from "./timer-store";

export function notifyTimerCompletion(snapshot: TimerSnapshot): boolean {
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  )
    return false;
  try {
    new Notification(snapshot.phase === "focus" ? "专注完成" : "休息完成", {
      body: "计时阶段已结束。",
      tag: snapshot.completionId ?? `timer-${snapshot.generation}`,
    });
    return true;
  } catch {
    return false;
  }
}
