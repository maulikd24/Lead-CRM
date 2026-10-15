import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe("display font (Redaction)", () => {
  it("is declared as --font-display with a Sora fallback", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('variable: "--font-display"');
    expect(layout).toContain("redaction.variable");
    expect(read("src/app/globals.css")).toMatch(/--font-display: var\(--font-display\), var\(--font-sora\)/);
    expect(readFileSync(join(process.cwd(), "src/app/fonts/REDACTION-LICENSE.txt"), "utf8")).toContain("SIL Open Font License");
  });

  it("is not used by tables, forms, KPI or money components", () => {
    const offenders = walk("src")
      .filter((f) => /\.tsx$/.test(f) && !f.includes(".test.") && !f.includes("/login/") && /(table|form|kpi|money|currency|stat)/i.test(f))
      .filter((f) => /font-display|--font-display|--fd-display/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
