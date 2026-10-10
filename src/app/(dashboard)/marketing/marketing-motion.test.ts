import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The marketing workspace's motion rule: every animation is 300ms or shorter, nothing loops, reduced motion turns every one off. */
const css = readFileSync(join(__dirname, "marketing.module.css"), "utf8");
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

function animationDeclarations(): { selector: string; value: string }[] {
  const out: { selector: string; value: string }[] = [];
  for (const rule of noComments.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    for (const decl of rule[2].matchAll(/animation\s*:\s*([^;]+);/g)) out.push({ selector: rule[1].trim(), value: decl[1].trim() });
  }
  return out;
}
const ms = (v: string) => {
  const m = v.match(/(\d+(?:\.\d+)?)(ms|s)\b/);
  if (!m) return NaN;
  return m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
};

describe("marketing workspace motion", () => {
  const all = animationDeclarations().filter((d) => d.value !== "none");
  it("finds the animations it is checking", () => expect(all.length).toBeGreaterThan(5));
  it("never loops", () => {
    for (const d of all) expect(d.value, d.selector).not.toMatch(/infinite/);
  });
  it("keeps every animation to 300ms or shorter, the live-connection dot included", () => {
    for (const d of all) expect(ms(d.value), `${d.selector}: ${d.value}`).toBeLessThanOrEqual(300);
  });
  it("the live dot plays one soft pulse", () => {
    const dot = all.find((d) => d.selector === ".liveDot");
    expect(dot?.value).toMatch(/pulse\s+\d+ms/);
  });
  it("switches every animated class off for reduced motion, the live dot included", () => {
    const block = noComments.slice(noComments.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const d of all) for (const cls of d.selector.split(",").map((s) => s.trim()).filter((s) => s.startsWith("."))) expect(block, cls).toContain(cls);
  });
});
