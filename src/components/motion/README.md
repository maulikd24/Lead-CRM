# Motion toolkit

Purposeful, calm motion. Everything here honours `prefers-reduced-motion` (animations become instant/disabled) and renders final values on the server.

- `tokens.ts` – the only place for durations, easings, stagger and polling timings. `motionEnabled()` reads the `NEXT_PUBLIC_MOTION=1` kill switch (unset = static components).
- `useReducedMotion()` – SSR-safe (server snapshot is `false`).
- `<CountUp value format="number|inr|inr-compact|percent" decimals />` – Indian grouping, tabular numerals, animates between values.
- `<FadeIn>`, `<Stagger>` + `<StaggerItem>`, `<PageTransition>` – entrances.
- `<Pulse>` live dot (CSS, motion-safe) and `<PulseRing trigger={n}>` one-shot ring when `n` changes.
- `chartMotionProps(reduced)` / `useChartMotion()` – spread on a Recharts series; `<DrawIn>` reveals a chart container; `<DrawPath>` draws an SVG path (sparklines).
- `fireConfetti(eventId)` – lazy-loads `canvas-confetti`, once per id, never under reduced motion.

```tsx
<CountUp value={total} format="inr-compact" />
<Area dataKey="value" {...useChartMotion()} />
```
