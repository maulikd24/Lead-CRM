import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Accessibility pin: the sidebar tokens keep their contrast in both themes (light sidebar in light, black in dark). */
const css = fs.readFileSync(path.resolve(__dirname, "globals.css"), "utf8");
const block = (sel: string) => css.match(new RegExp(`(?:^|\\n)${sel.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)\\n\\}`))![1];
const token = (b: string, name: string) => b.match(new RegExp(`--${name}:\\s*([^;]+);`))![1].trim();

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const lum = (c: number[]) => {
  const f = (x: number) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = c.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const mix = (fg: number[], bg: number[], a: number) => fg.map((v, i) => v * a + bg[i] * (1 - a));

describe.each([
  ["light", ":root"],
  ["dark", ".dark"],
])("sidebar tokens, %s theme", (_name, sel) => {
  const b = block(sel);
  const bg = rgb(token(b, "sidebar"));
  const fg = rgb(token(b, "sidebar-foreground"));
  const alpha = (name: string) => parseFloat(token(b, name)) / 100;

  it("primary text is >= 7:1 on the sidebar", () => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(7));
  it("secondary and subtle text (the alpha tokens) are >= 4.5:1 on the sidebar", () => {
    expect(ratio(mix(fg, bg, alpha("sidebar-muted-alpha")), bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(mix(fg, bg, alpha("sidebar-subtle-alpha")), bg)).toBeGreaterThanOrEqual(4.5);
  });
  it("the active item (lime) text is >= 4.5:1", () => {
    expect(ratio(rgb(token(b, "sidebar-primary-foreground")), rgb(token(b, "sidebar-primary")))).toBeGreaterThanOrEqual(4.5);
  });
  it("hover and sub-item text is >= 4.5:1 on the accent tint", () => {
    expect(ratio(rgb(token(b, "sidebar-accent-foreground")), rgb(token(b, "sidebar-accent")))).toBeGreaterThanOrEqual(4.5);
  });
  it("the focus ring is >= 3:1 on the sidebar", () => expect(ratio(rgb(token(b, "sidebar-ring")), bg)).toBeGreaterThanOrEqual(3));
});

it("the light sidebar is light and the dark sidebar stays black", () => {
  expect(lum(rgb(token(block(":root"), "sidebar")))).toBeGreaterThan(0.8);
  expect(lum(rgb(token(block(".dark"), "sidebar")))).toBeLessThan(0.01);
});
