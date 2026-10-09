// SVG donut geometry. Segments are drawn as stroked circle arcs (stroke-dasharray) so the draw-in animation is a
// plain CSS transition of stroke-dashoffset: no path maths in the browser, no animation library.

export type RingRow = { label: string; value: number };
export type RingSegment = { label: string; value: number; pct: number; length: number; offset: number; color: string };
export type Ring = { total: number; circumference: number; radius: number; strokeWidth: number; viewBox: number; segments: RingSegment[] };

/** Theme tokens only (never a literal colour); anything past the fifth segment shares the muted tone. */
export function ringColorVar(index: number): string {
  return index >= 0 && index < 5 ? `var(--chart-${index + 1})` : "var(--muted-foreground)";
}

export function buildRing(rows: RingRow[], opts: { radius: number; strokeWidth: number; gap: number }): Ring {
  const { radius, strokeWidth, gap } = opts;
  const circumference = 2 * Math.PI * radius;
  const positive = rows.filter((r) => Number.isFinite(r.value) && r.value > 0);
  const total = positive.reduce((sum, r) => sum + r.value, 0);
  const viewBox = 2 * radius + strokeWidth;
  if (total <= 0) return { total: 0, circumference, radius, strokeWidth, viewBox, segments: [] };

  const useGap = positive.length > 1 ? gap : 0;
  let cursor = 0;
  const segments = positive.map((r, i): RingSegment => {
    const share = r.value / total;
    const full = share * circumference;
    const segment: RingSegment = {
      label: r.label,
      value: r.value,
      pct: Math.round(share * 1000) / 10,
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
