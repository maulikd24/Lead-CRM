import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The consumer referral programme must stand on its own. The older read-only external-referral view under /partners is being
 * retired by another branch; nothing here may import it (or the partner code at all: the one seam is partner-probe.ts, which
 * imports nothing). Turning off or removing the partner workspace therefore cannot break this programme.
 */
const root = path.resolve(__dirname, "../../..");
const dirs = ["src/lib/referrals", "src/app/(dashboard)/referrals", "src/app/api/webhooks/app-signup"];
const PARTNER_SIDE = String.raw`(?:@\/lib\/partners|@\/lib\/integrations\/adapters\/(?:mock\/)?referral-api|@\/app\/\(dashboard\)\/partners|[./]+\/partners)[^"']*`;
// A named import, a bare side-effect import, a dynamic import and a require: all count.
const FORBIDDEN = new RegExp(String.raw`(?:from\s+|import\s+|import\(\s*|require\(\s*)["']${PARTNER_SIDE}["']`);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("the referral programme does not depend on the partner workspace or the old external referral service", () => {
  const files = dirs.flatMap((d) => sourceFiles(path.join(root, d)));
  it("scans a meaningful set of files", () => expect(files.length).toBeGreaterThan(25));
  it.each(files.map((f) => [path.relative(root, f), f]))("%s imports nothing from the partner side", (_rel, file) => {
    expect(readFileSync(file as string, "utf8")).not.toMatch(FORBIDDEN);
  });
  it("the partner seam imports nothing at all", () => {
    expect(readFileSync(path.join(root, "src/lib/referrals/partner-probe.ts"), "utf8")).not.toMatch(/^\s*import\s/m);
  });
  it("the retired view is not referenced by name anywhere in the referral screens", () => {
    for (const f of files.filter((x) => x.includes("(dashboard)/referrals"))) expect(readFileSync(f, "utf8")).not.toMatch(/\/partners|referral-api|external referral/i);
  });
});
