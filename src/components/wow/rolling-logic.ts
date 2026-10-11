/** One character of a rolling number: a digit that rolls, or a fixed character (separator, currency sign, percent). */
export type RollPart = { kind: "digit"; digit: number } | { kind: "fixed"; char: string };

/** The longest any digit takes to land, ms. The whole app keeps motion to 300ms or less, so the stagger below leaves room for it. */
export const ROLL_MAX_MS = 240;

export function splitRolling(text: string): RollPart[] {
  return Array.from(text).map((char) => (/[0-9]/.test(char) ? { kind: "digit", digit: Number(char) } : { kind: "fixed", char }));
}

/** Delay before digit `index` of `count` starts: a small left-to-right stagger (at most 60ms in all), so the last digit still lands by 300ms. */
export function rollDelayMs(index: number, count: number): number {
  if (count <= 1) return 0;
  return Math.round((index / (count - 1)) * 60);
}
