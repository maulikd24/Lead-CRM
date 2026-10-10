import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The workspace pattern's motion rule: every animation is 300ms or shorter, nothing loops, reduced motion turns every one off. */
const css = readFileSync(join(__dirname, "workspace.module.css"), "utf8");
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

function declarations(prop: "animation" | "transition"): { selector: string; value: string }[] {
  const out: { selector: string; value: string }[] = [];
  for (const rule of noComments.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    for (const decl of rule[2].matchAll(new RegExp(`(?:^|[\\s;])${prop}\\s*:\\s*([^;]+);`, "g"))) out.push({ selector: rule[1].trim(), value: decl[1].trim() });
  }
  return out;
}
const ms = (v: string) => {
  const m = v.match(/(\d+(?:\.\d+)?)(ms|s)\b/);
  return m ? (m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1])) : NaN;
};
const animations = declarations("animation").filter((d) => d.value !== "none");
const transitions = declarations("transition").filter((d) => d.value !== "none");
const reduced = noComments.slice(noComments.indexOf("@media (prefers-reduced-motion: reduce)"));

describe("workspace motion", () => {
  it("finds the animations it is checking", () => {
    expect(animations.length).toBeGreaterThanOrEqual(8);
    expect(transitions.length).toBeGreaterThanOrEqual(2);
  });
  it("never loops", () => {
    for (const d of [...animations, ...transitions]) expect(d.value, d.selector).not.toMatch(/infinite/);
  });
  it("keeps every animation and transition to 300ms or shorter", () => {
    for (const d of [...animations, ...transitions]) expect(ms(d.value), `${d.selector}: ${d.value}`).toBeLessThanOrEqual(300);
  });
  it("has a reduced-motion block that switches off every animated class", () => {
    expect(reduced).toContain("@media (prefers-reduced-motion: reduce)");
    for (const d of animations) for (const cls of d.selector.split(",").map((s) => s.trim()).filter((s) => s.startsWith("."))) expect(reduced, cls).toContain(cls);
  });
  it("switches off the hover lift and the tab transition for reduced motion", () => {
    for (const cls of [".lift", ".tab"]) expect(reduced, cls).toContain(cls);
    expect(reduced).toMatch(/\.lift:hover\s*\{\s*transform:\s*none/);
  });
  it("uses theme tokens only (no hard-coded colours)", () => {
    expect(noComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(noComments).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });
});
