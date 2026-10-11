/**
 * Pure helpers for the "wow" kit (KPI cards, sparklines, area charts). No React, no DOM: everything here is unit tested.
 * Nothing in this file invents data: a delta needs both periods, a sparkline needs real history.
 */

export type Delta = { pct: number; direction: "up" | "down" | "flat" };

const round = (n: number) => Math.round(n * 100) / 100;
const num = (n: number) => String(+round(n).toFixed(2));

/** Percentage change from the previous period to the current one. Absent when either side is unknown or the previous period was zero (a percentage of zero is meaningless). */
export function computeDelta(current: number | null | undefined, previous: number | null | undefined): Delta | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  const raw = ((current - previous) / Math.abs(previous)) * 100;
  const pct = Math.abs(raw) < 10 ? Math.round(raw * 10) / 10 : Math.round(raw);
  return { pct, direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The last `n` days against the `n` days before them. Absent without `2n` days of history. */
export function trailingWindows(series: readonly number[] | null | undefined, n: number): { current: number; previous: number } | null {
  if (!series || n < 1 || series.length < 2 * n) return null;
  return { current: sum(series.slice(-n)), previous: sum(series.slice(-2 * n, -n)) };
}

/** The later half of a range against the earlier half: the honest comparison for a chart that was only loaded for one range. */
export function splitHalves(series: readonly number[] | null | undefined): { current: number; previous: number } | null {
  if (!series || series.length < 2) return null;
  const half = Math.floor(series.length / 2);
  return { current: sum(series.slice(-half)), previous: sum(series.slice(0, half)) };
}

/** A sparkline is only drawn from real history: at least two points and something other than all zeros. */
export function hasHistory(values: readonly number[] | null | undefined): values is readonly number[] {
  return !!values && values.length >= 2 && values.some((v) => v !== 0 && Number.isFinite(v));
}

export type Box = { w: number; h: number; pad?: number; min?: number; max?: number };

function points(values: readonly number[], box: Box): [number, number][] {
  const pad = box.pad ?? 0;
  const lo = box.min ?? Math.min(...values);
  const hi = box.max ?? Math.max(...values);
  const span = hi - lo;
  const n = values.length;
  return values.map((v, i) => {
    const x = n === 1 ? box.w / 2 : pad + (i / (n - 1)) * (box.w - 2 * pad);
    const y = span === 0 ? box.h / 2 : box.h - pad - ((v - lo) / span) * (box.h - 2 * pad);
    return [x, y];
  });
}

/** Monotone cubic (Fritsch-Carlson) control points: smooth, never overshoots a data point. */
function smooth(p: [number, number][]): string {
  const n = p.length;
  if (n === 1) return `M${num(p[0][0])} ${num(p[0][1])}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(p[i + 1][0] - p[i][0]);
    m.push(dx[i] === 0 ? 0 : (p[i + 1][1] - p[i][1]) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${num(p[0][0])} ${num(p[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${num(p[i][0] + h)} ${num(p[i][1] + t[i] * h)} ${num(p[i + 1][0] - h)} ${num(p[i + 1][1] - t[i + 1] * h)} ${num(p[i + 1][0])} ${num(p[i + 1][1])}`;
  }
  return d;
}

export function linePath(values: readonly number[], box: Box): string {
  return values.length === 0 ? "" : smooth(points(values, box));
}

/** The line closed down to the baseline, for the soft fill under it. */
export function areaPath(values: readonly number[], box: Box): string {
  if (values.length === 0) return "";
  const p = points(values, box);
  const base = box.h - (box.pad ?? 0);
  return `${smooth(p)} L${num(p[p.length - 1][0])} ${num(base)} L${num(p[0][0])} ${num(base)}Z`;
}

/** The point positions the line passes through (hover dots and the crosshair use them). */
export function pointsOf(values: readonly number[], box: Box): [number, number][] {
  return values.length === 0 ? [] : points(values, box);
}

/** A maximum rounded up to 1, 2, 5 or 10 times a power of ten. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function tickValues(max: number, steps: number): number[] {
  return Array.from({ length: steps + 1 }, (_, i) => (max / steps) * i);
}

function resample(v: readonly number[], len: number): number[] {
  if (v.length === len) return [...v];
  if (v.length === 0) return Array(len).fill(0);
  if (v.length === 1) return Array(len).fill(v[0]);
  return Array.from({ length: len }, (_, i) => {
    const pos = (i / (len - 1)) * (v.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(v.length - 1, lo + 1);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  });
}

/** One frame of the morph from one series to another (t from 0 to 1). */
export function lerpValues(from: readonly number[], to: readonly number[], t: number): number[] {
  const len = Math.max(from.length, to.length);
  const a = resample(from, len);
  const b = resample(to, len);
  return a.map((x, i) => x + (b[i] - x) * t);
}

export const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** The data point nearest to a pointer `px` across a plot `width` wide. */
export function nearestIndex(px: number, width: number, n: number): number {
  if (n <= 1 || width <= 0) return 0;
  return Math.min(n - 1, Math.max(0, Math.round((px / width) * (n - 1))));
}

/** Arrow keys, Home and End move the chart's crosshair; Escape clears it. */
export function stepIndex(key: string, index: number | null, n: number): number | null {
  if (key === "Escape") return null;
  if (n <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  if (key === "ArrowRight") return index === null ? 0 : Math.min(n - 1, index + 1);
  if (key === "ArrowLeft") return index === null ? n - 1 : Math.max(0, index - 1);
  return index;
}

export type ValueFormat = { kind: "count" } | { kind: "inr" } | { kind: "percent"; decimals?: number } | { kind: "money"; currency: string | null };

const IN = "en-IN";

/** Chart values as text. `compact` is for axes ("₹5.2L"); the tooltip and the headline use the full figure. */
export function formatValue(format: ValueFormat, value: number, compact = false): string {
  if (!Number.isFinite(value)) return "—";
  switch (format.kind) {
    case "count":
      return Math.round(value).toLocaleString(IN);
    case "percent":
      return `${value.toLocaleString(IN, { minimumFractionDigits: format.decimals ?? 0, maximumFractionDigits: format.decimals ?? 0 })}%`;
    case "inr": {
      if (!compact) return `₹${Math.round(value).toLocaleString(IN)}`;
      const abs = Math.abs(value);
      const sign = value < 0 ? "-" : "";
      if (abs >= 1e7) return `${sign}₹${+(abs / 1e7).toFixed(1)}Cr`;
      if (abs >= 1e5) return `${sign}₹${+(abs / 1e5).toFixed(1)}L`;
      if (abs >= 1e3) return `${sign}₹${+(abs / 1e3).toFixed(1)}K`;
      return `${sign}₹${Math.round(abs)}`;
    }
    case "money": {
      const code = format.currency && /^[A-Z]{3}$/.test(format.currency) ? format.currency : null;
      if (!code) return Math.round(value).toLocaleString(IN);
      return new Intl.NumberFormat(IN, { style: "currency", currency: code, notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 0 }).format(value);
    }
  }
}

/** The x labels that are shown under a chart: at most `max`, evenly spread, always the first and the last. */
export function xLabelIndices(n: number, max: number): number[] {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>([0, n - 1]);
  for (let k = 1; k < max - 1; k++) out.add(Math.round((k / (max - 1)) * (n - 1)));
  return [...out].sort((a, b) => a - b);
}
