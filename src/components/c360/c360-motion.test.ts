import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Customer 360 motion: every animation and transition is 300ms or shorter, nothing loops, reduced motion turns each one off. */
const css = readFileSync(join(__dirname, "c360.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const reducedAt = css.indexOf("@media (prefers-reduced-motion: reduce)");
const live = css.slice(0, reducedAt);
const reduced = css.slice(reducedAt);

const decls = (prop: string) => [...live.matchAll(new RegExp(`(?:^|[\\s;{])${prop}\\s*:\\s*([^;]+);`, "g"))].map((m) => m[1].trim()).filter((v) => v !== "none");
const firstMs = (v: string) => {
  const m = v.match(/(\d+(?:\.\d+)?)(ms|s)\b/);
  return m ? (m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1])) : NaN;
};

describe("customer 360 motion", () => {
  const all = [...decls("animation"), ...decls("transition")];
  it("finds what it checks", () => expect(all.length).toBeGreaterThanOrEqual(4));
  it("never loops", () => {
    for (const v of all) expect(v).not.toMatch(/infinite/);
  });
  it("keeps every duration to 300ms or shorter", () => {
    for (const v of all) expect(firstMs(v), v).toBeLessThanOrEqual(300);
  });
  it("switches every animated class off for reduced motion", () => {
    for (const cls of [".c360-rise", ".c360-seg", ".c360-vfill", ".c360-pulse::after"]) expect(reduced, cls).toContain(cls);
  });
});
