import styles from "./workspace.module.css";

/**
 * CSS-only motion classes, all 300ms or shorter, played once, and off under prefers-reduced-motion.
 * Put them on any element. Stagger a group with `style={{ "--i": index }}`.
 */
export const motion = {
  /** Card or tile entrance (fade and rise). */
  enter: styles.enter,
  /** Hover lift for something that can be pointed at. */
  lift: styles.lift,
  /** Chart container that reveals left to right. */
  draw: styles.draw,
  /** SVG path (give it pathLength="1") that draws itself. */
  drawLine: styles.drawLine,
  /** Horizontal bar that grows from the left. */
  growX: styles.growX,
  /** Vertical bar that grows from the bottom (SVG rects too). */
  growY: styles.growY,
  /** Live-feed dot: one soft pulse, then still. */
  liveDot: styles.liveDot,
} as const;
