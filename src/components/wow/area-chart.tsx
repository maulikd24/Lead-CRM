"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { motion } from "@/components/workspace/motion-classes";
import { cn } from "@/lib/utils";

import styles from "./wow.module.css";
import {
  areaPath,
  easeOut,
  formatValue,
  lerpValues,
  linePath,
  nearestIndex,
  niceMax,
  pointsOf,
  stepIndex,
  tickValues,
  xLabelIndices,
  type Delta,
  type ValueFormat,
} from "./wow-logic";

export type ChartSeries = {
  key: string;
  label: string;
  /** One value per x label, oldest first. Real history only. */
  values: number[];
  format: ValueFormat;
  /** Optional precomputed change against the previous period (serialisable, so a server page can pass it). */
  delta?: Delta | null;
  /** What the headline figure is: the total of the range (default), the latest point, or the average. */
  headline?: "sum" | "last" | "avg";
};

/** The morph between two series takes this long (one easing curve, under the 300ms budget). */
export const MORPH_MS = 260;
/** Count-up of the tooltip value when the crosshair moves. */
const TIP_MS = 140;
const HEIGHT = 224;
const M = { t: 14, r: 12, b: 26 };

/** Animates a number to its target once per change (rAF, no loop). Reduced motion: the target at once. */
function useTween(target: number, ms: number, reduced: boolean): number {
  const [n, setN] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (reduced) return;
    const from = cur.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      cur.current = from + (target - from) * easeOut(t);
      setN(cur.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return reduced ? target : n;
}

/**
 * An area chart in plain SVG: soft fill, dotted gridlines, a hover (or keyboard) crosshair with a tooltip whose value counts up,
 * and a smooth morph when the active series changes. It reveals once on arrival; nothing loops. Reduced motion: no reveal, no
 * morph, no count-up. The plot is keyboard reachable (Left/Right/Home/End move the crosshair, Escape clears it) and announces the
 * point it is on. Draws only the values it is given: it never smooths over or fills in missing history.
 */
export function AreaChart({ labels, series, activeKey, ariaLabel, height = HEIGHT, className }: { labels: string[]; series: ChartSeries[]; activeKey: string; ariaLabel: string; height?: number; className?: string }) {
  const reduced = useReducedMotion();
  const gid = useId();
  const active = series.find((s) => s.key === activeKey) ?? series[0];
  const target = active.values;
  const targetMax = niceMax(Math.max(0, ...target));
  const sig = `${active.key}|${target.join(",")}`;

  const [anim, setAnim] = useState({ values: target, max: targetMax });
  const shown = useRef(anim);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reduced) return;
    const a = shown.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / MORPH_MS);
      const e = easeOut(t);
      shown.current = { values: lerpValues(a.values, target, e), max: a.max + (targetMax - a.max) * e };
      setAnim(shown.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sig` stands for the series content, so a parent re-render with equal data does not restart the morph
  }, [sig, reduced]);
  const view = reduced ? { values: target, max: targetMax } : anim;

  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [hover, setHover] = useState<number | null>(null);
  const n = view.values.length;
  const ticks = tickValues(view.max, 4);
  const left = Math.max(30, 14 + Math.max(...ticks.map((t) => formatValue(active.format, t, true).length)) * 6.1);
  const plot = { w: width, h: height, left, right: M.r, top: M.t, bottom: M.b };
  const geo = { w: width - left - M.r, h: height - M.t - M.b, min: 0, max: view.max };
  const pts = pointsOf(view.values, geo).map(([x, y]) => [x + left, y + M.t] as const);
  const lineD = linePath(view.values, geo);
  const areaD = areaPath(view.values, geo);
  const labelAt = xLabelIndices(n, width < 420 ? 4 : 7);

  const tipValue = hover !== null ? target[hover] ?? 0 : 0;
  const tweened = useTween(tipValue, TIP_MS, reduced);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(nearestIndex(e.clientX - r.left - left, geo.w, n));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "Escape") {
      if (hover !== null) { e.preventDefault(); setHover(null); }
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    setHover(stepIndex(e.key, hover, n));
  };

  const hp = hover !== null ? pts[hover] : null;
  const tipLeft = hp ? Math.min(width - 62, Math.max(62, hp[0])) : 0;
  const fillId = `${gid}-f`;
  const announce = hover !== null ? `${labels[hover]}: ${formatValue(active.format, target[hover] ?? 0)} ${active.label}` : "";
  const total = target.reduce((a, b) => a + b, 0);
  const summary = `${active.label} over ${n} points, from ${formatValue(active.format, target[0] ?? 0)} to ${formatValue(active.format, target[n - 1] ?? 0)}, total ${formatValue(active.format, total)}.`;

  return (
    <div
      ref={box}
      className={cn(styles.plot, className)}
      role="group"
      aria-roledescription="chart"
      aria-label={`${ariaLabel}. ${summary} Use the left and right arrow keys to read each point.`}
      tabIndex={0}
      onPointerMove={onMove}
      onPointerDown={onMove}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
    >
      <div className={motion.draw}>
        <svg viewBox={`0 0 ${plot.w} ${plot.h}`} width={plot.w} height={plot.h} aria-hidden focusable="false">
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className={styles.grid}>
            {ticks.map((t) => {
              const y = M.t + geo.h - (t / (view.max || 1)) * geo.h;
              return <line key={t} x1={left} x2={width - M.r} y1={y} y2={y} />;
            })}
          </g>
          {ticks.map((t) => {
            const y = M.t + geo.h - (t / (view.max || 1)) * geo.h;
            return (
              <text key={t} className={styles.axis} x={left - 8} y={y + 3.5} textAnchor="end">
                {formatValue(active.format, t, true)}
              </text>
            );
          })}
          <g transform={`translate(${left} ${M.t})`}>
            <path d={areaD} fill={`url(#${fillId})`} />
            <path d={lineD} fill="none" stroke="var(--primary-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          {labelAt.map((i) => (
            <text key={i} className={styles.axis} x={pts[i]?.[0] ?? 0} y={height - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
              {labels[i]}
            </text>
          ))}
          {hp && (
            <g>
              <line className={styles.cross} x1={hp[0]} x2={hp[0]} y1={M.t} y2={M.t + geo.h} />
              <circle className={styles.dot} cx={hp[0]} cy={hp[1]} r="4.5" />
            </g>
          )}
        </svg>
      </div>
      <div className={styles.tip} data-show={hp ? "true" : "false"} style={hp ? { left: tipLeft, top: Math.max(0, hp[1] - 62), transform: "translateX(-50%)" } : { left: 0, top: 0 }} aria-hidden>
        <p className={styles.tipLabel}>{hover !== null ? labels[hover] : ""}</p>
        <p className={styles.tipValue}>{formatValue(active.format, tweened)}</p>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
