/** Single source of truth for motion timing. Seconds unless noted. Owner rule: every animation is 300ms or shorter and plays once. */
export const DURATION = {
  fast: 0.15,
  base: 0.22,
  slow: 0.3,
  count: 0.3,
  chart: 0.3,
} as const;

/** Cubic-bezier control points (Motion accepts these directly). */
export const EASE = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const;

/** Delay between siblings in a staggered entrance. */
export const STAGGER = 0.04;
/** Delay between funnel stages so the flow reads top to bottom. */
export const FUNNEL_STEP = 0.06;

/** Live-data polling: base interval, and the ceiling once the server keeps failing. */
export const LIVE = { pollMs: 20_000, maxBackoffMs: 120_000, minIntervalMs: 5_000 } as const;

/** Flag: `NEXT_PUBLIC_MOTION=1` turns the animated components on; unset renders the static ones. */
export function motionEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MOTION === "1";
}
