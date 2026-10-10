import { motionEnabled } from "./tokens";

const fired = new Set<string>();

/** Pure gate: never under reduced motion, and only once per event id. */
export function shouldFireConfetti(eventId: string, reduced: boolean): boolean {
  return !reduced && !fired.has(eventId);
}
export function markFired(eventId: string) {
  fired.add(eventId);
}
export function _resetFired() {
  fired.clear();
}

/** Subtle burst; canvas-confetti is loaded lazily so it never weighs on the initial bundle. */
export async function fireConfetti(eventId: string): Promise<boolean> {
  if (typeof window === "undefined" || !motionEnabled()) return false;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (!shouldFireConfetti(eventId, reduced)) return false;
  markFired(eventId);
  try {
    const { default: confetti } = await import("canvas-confetti");
    const css = getComputedStyle(document.documentElement);
    const colors = ["--primary", "--foreground"].map((v) => css.getPropertyValue(v).trim()).filter(Boolean);
    confetti({ particleCount: 60, spread: 70, startVelocity: 28, ticks: 140, gravity: 1.1, scalar: 0.8, origin: { x: 0.5, y: 0.25 }, disableForReducedMotion: true, ...(colors.length ? { colors } : {}) });
    return true;
  } catch {
    return false;
  }
}
