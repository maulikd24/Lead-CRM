/** Single source of truth for motion timing. Seconds unless noted. Keep everything short and calm. */
export const DURATION = {
  fast: 0.18,
  base: 0.4,
  slow: 0.8,
  count: 0.9,
  chart: 0.9,
} as const;

/** Cubic-bezier control points (Motion accepts these directly). */
export const EASE = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const;

/** Delay between siblings in a staggered entrance. */
export const STAGGER = 0.06;
/** Delay between funnel stages so the flow reads top to bottom. */
export const FUNNEL_STEP = 0.22;

/** Live-data polling: base interval, and the ceiling once the server keeps failing. */
export const LIVE = { pollMs: 20_000, maxBackoffMs: 120_000 } as const;

/** Flag: `NEXT_PUBLIC_MOTION=1` turns the animated components on; unset renders the static ones. */
export function motionEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MOTION === "1";
}
