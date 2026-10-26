import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

// Two families only (docs/ux/design-system.md): Inter for the interface, Sora for display and headings. Redaction was retired in the
// UX revamp: a third face cost a download and read as a different product next to Sora.
describe("display font", () => {
  it("is Sora, behind the same --font-display token", () => {
    expect(read("src/app/globals.css")).toMatch(/--font-display: var\(--font-sora\), var\(--font-inter\)/);
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('variable: "--font-sora"');
    expect(layout).toContain('variable: "--font-inter"');
  });

  it("no longer ships or references Redaction", () => {
    expect(existsSync(join(process.cwd(), "src/app/fonts/Redaction-Regular.woff2"))).toBe(false);
    const offenders = walk("src").filter((f) => /\.(tsx?|css)$/.test(f) && !f.includes(".test.")).filter((f) => /redaction\.variable|Redaction-(Regular|Bold)/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("headings that use it are semibold, never the thin 400 a serif display face wanted", () => {
    for (const f of ["src/components/shared/page-header.tsx", "src/components/workspace/workspace-heading.tsx"]) expect(read(f)).toMatch(/font-display [^"]*font-semibold/);
  });
});
