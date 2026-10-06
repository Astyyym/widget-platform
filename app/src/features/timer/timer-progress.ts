import type { TimerSnapshot } from "./timer-store";

export function timerCountdownProgress(snapshot: TimerSnapshot | null, now: number): number | undefined {
  if (!snapshot || snapshot.state === "idle" || snapshot.durationMs <= 0) return undefined;
  if (snapshot.state === "completed") return 0;
  const remaining = snapshot.state === "running" && snapshot.deadlineUtc !== null && !snapshot.clockAnomaly
    ? Math.max(0, snapshot.deadlineUtc - now) : snapshot.remainingMs;
  return Math.max(0, Math.min(100, remaining / snapshot.durationMs * 100));
}
