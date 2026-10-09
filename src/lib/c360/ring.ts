// SVG donut geometry. Segments are drawn as stroked circle arcs (stroke-dasharray) so the draw-in animation is a
// plain CSS transition of stroke-dashoffset: no path maths in the browser, no animation library.

export type RingRow = { label: string; value: number };
export type RingSegment = { label: string; value: number; pct: number; length: number; offset: number; color: string };
export type Ring = { total: number; circumference: number; radius: number; strokeWidth: number; viewBox: number; segments: RingSegment[] };

/** Theme tokens only (never a literal colour). Segments past the fifth reuse the chart tokens softened toward the
 * background, so each stays distinct (the legend also labels every segment with its percentage). */
export function ringColorVar(index: number): string {
  const i = Math.max(0, index);
  return i < 5 ? `var(--chart-${i + 1})` : `color-mix(in srgb, var(--chart-${(i % 5) + 1}) 55%, var(--background))`;
}

/** Percentages to one decimal that always add up to exactly 100.0 (largest-remainder rounding). */
function percentages(values: number[], total: number): number[] {
  const raw = values.map((v) => (v / total) * 1000);
  const floors = raw.map(Math.floor);
  let left = 1000 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]++;
    left--;
  }
  return floors.map((f) => f / 10);
}

export function buildRing(rows: RingRow[], opts: { radius: number; strokeWidth: number; gap: number }): Ring {
  const { radius, strokeWidth, gap } = opts;
  const circumference = 2 * Math.PI * radius;
  const positive = rows.filter((r) => Number.isFinite(r.value) && r.value > 0);
  const total = positive.reduce((sum, r) => sum + r.value, 0);
  const viewBox = 2 * radius + strokeWidth;
  if (total <= 0) return { total: 0, circumference, radius, strokeWidth, viewBox, segments: [] };

  const useGap = positive.length > 1 ? gap : 0;
  const pcts = percentages(positive.map((r) => r.value), total);
  let cursor = 0;
  const segments = positive.map((r, i): RingSegment => {
    const share = r.value / total;
    const full = share * circumference;
    const segment: RingSegment = {
      label: r.label,
      value: r.value,
      pct: pcts[i],
      // Keep a hairline minimum so a tiny holding stays visible, never negative.
      length: Math.max(full - useGap, Math.min(full, 0.5)),
      offset: cursor === 0 ? 0 : -cursor,
      color: ringColorVar(i),
    };
    cursor += full;
    return segment;
  });
  return { total, circumference, radius, strokeWidth, viewBox, segments };
}
