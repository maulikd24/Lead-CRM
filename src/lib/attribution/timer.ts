import { formatDuration } from "./journey";

/** The speed-to-lead clock as words: time left while inside the SLA, time past it after. Pure, so the client timer only renders it. */
export function speedTimer(dueAtMs: number, nowMs: number): { state: "running" | "breached"; label: string; urgent: boolean } {
  const left = dueAtMs - nowMs;
  if (left >= 0) return { state: "running", label: `${formatDuration(left)} left`, urgent: left <= 5 * 60_000 };
  return { state: "breached", label: `${formatDuration(-left)} past the SLA`, urgent: true };
}
