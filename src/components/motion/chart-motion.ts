import { DURATION } from "./tokens";
import { useReducedMotion } from "./use-reduced-motion";

/** Props to spread on a Recharts series (Line/Area/Bar). Off under reduced motion. Motion-library free. */
export function chartMotionProps(reduced: boolean): { isAnimationActive: boolean; animationDuration?: number; animationEasing?: "ease-out" } {
  if (reduced) return { isAnimationActive: false };
  return { isAnimationActive: true, animationDuration: Math.round(DURATION.chart * 1000), animationEasing: "ease-out" };
}

export function useChartMotion() {
  return chartMotionProps(useReducedMotion());
}
