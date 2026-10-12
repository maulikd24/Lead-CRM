import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The workspace motion rule applied to the Duplicate review styles: 300ms or shorter, plays once, only when motion is allowed, theme tokens only. */
const css = readFileSync(join(__dirname, "duplicates.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const animations = [...css.matchAll(/(?:^|[\s;{])animation\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
const ms = (v: string) => {
  const m = v.match(/(\d+(?:\.\d+)?)(ms|s)\b/);
  return m ? (m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1])) : NaN;
};
const gated = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"));

describe("duplicate review motion", () => {
  it("finds the animations it is checking", () => {
    expect(animations.length).toBeGreaterThanOrEqual(4);
  });
  it("keeps every animation to 300ms or shorter, and nothing loops", () => {
    for (const a of animations) {
      expect(ms(a), a).toBeLessThanOrEqual(300);
      expect(a).not.toMatch(/infinite/);
    }
  });
  it("starts no delay that stretches past 300ms in total", () => {
    for (const d of css.matchAll(/animation-delay\s*:\s*([^;]+);/g)) expect(d[1]).not.toMatch(/\d{3,}ms/);
  });
  it("plays every animation only when the person has not asked for reduced motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    for (const m of css.matchAll(/(?:^|[\s;{])animation\s*:/g)) expect(gated.indexOf("animation"), String(m.index)).toBeGreaterThan(-1);
    expect(css.slice(0, css.indexOf("@media (prefers-reduced-motion: no-preference)"))).not.toMatch(/animation\s*:/);
  });
  it("uses theme tokens only", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });
});
