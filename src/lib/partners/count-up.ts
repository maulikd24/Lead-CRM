/** Easing and number formatting for the count-up tiles. Pure so it can be tested without a browser. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

export function countUpValue(target: number, progress: number, integer: boolean): number {
  const v = target * easeOutCubic(progress);
  return integer ? Math.round(v) : Math.round(v * 100) / 100;
}
