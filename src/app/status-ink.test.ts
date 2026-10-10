import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Accessibility pin: status text (red, green, amber) keeps >= 4.5:1 on the canvas and on its own 10%/20% tint, in both themes. */
const css = fs.readFileSync(path.resolve(__dirname, "globals.css"), "utf8");

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const lum = (c: number[]) => {
  const f = (x: number) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = c.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const mix = (fg: number[], bg: number[], a: number) => fg.map((v, i) => v * a + bg[i] * (1 - a));
const ink = (selector: string) => {
  const m = css.match(new RegExp(`${selector.replace(/[.:()]/g, "\\$&")}\\s*\\{\\s*color:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`no text ink rule for ${selector}`);
  return m[1];
};
const BRAND = { destructive: "#E5484D", success: "#1FA971", warning: "#F5A524" } as const;

describe("status text ink", () => {
  const light = [rgb("#FFFFFF"), rgb("#F8F9F8")];
  for (const key of ["destructive", "success", "warning"] as const) {
    it(`light mode ${key} text is >= 4.5:1 on white, the canvas and its 10% tint`, () => {
      const c = rgb(ink(`:root:not(.dark) .text-${key}`));
      for (const bg of light) {
        expect(ratio(c, bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(c, mix(rgb(BRAND[key]), bg, 0.1))).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it("dark mode destructive text is >= 4.5:1 on black, the card and their 10%/20% red tint", () => {
    const c = rgb(ink(".dark .text-destructive"));
    for (const bg of [rgb("#000000"), rgb("#0B0E0D")]) for (const a of [0, 0.1, 0.2]) expect(ratio(c, mix(rgb(BRAND.destructive), bg, a))).toBeGreaterThanOrEqual(4.5);
  });
});
