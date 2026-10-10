import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The pages converted to the workspace pattern keep their own motion in these files. Same budget as the shared pattern:
// 300ms or shorter, played once.
const FILES = ["src/components/consent/consent.module.css"];

describe("converted pages keep to the motion budget", () => {
  for (const file of FILES) {
    const css = readFileSync(file, "utf8");
    const declarations = [...css.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1]);
    it(`${file}: ${declarations.length} animations, none loop, none over 300ms`, () => {
      expect(declarations.length).toBeGreaterThan(0);
      for (const d of declarations) {
        expect(d).not.toMatch(/infinite/);
        const ms = [...d.matchAll(/(?<![\d.])(\d*\.?\d+)(ms|s)\b/g)].map((m) => (m[2] === "s" ? parseFloat(m[1]) * 1000 : parseFloat(m[1])));
        expect(Math.max(...ms), d).toBeLessThanOrEqual(300);
      }
    });
  }
});
