import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Screens that fold lists, open sheets or show master-detail must use the shared workspace kit (src/components/workspace), not a
 * private copy: one behaviour, one set of tests, one place to fix. This scans the screens that were built on their own branches.
 */
const root = path.resolve(__dirname, "../../..");
const dirs = ["src/components/partners", "src/app/(dashboard)/partners", "src/app/(dashboard)/partner-home", "src/app/(dashboard)/management-console", "src/app/(dashboard)/referrals", "src/app/(dashboard)/settings/partner-finance"];

function files(dir: string): string[] {
  const abs = path.join(root, dir);
  try {
    return readdirSync(abs).flatMap((n) => {
      const p = path.join(abs, n);
      const rel = path.join(dir, n);
      return statSync(p).isDirectory() ? files(rel) : /\.(ts|tsx|css)$/.test(n) && !/\.test\./.test(n) ? [rel] : [];
    });
  } catch {
    return [];
  }
}

describe("density conformance: the referral and partner screens use the shared kit", () => {
  const all = dirs.flatMap(files);
  it("scans a meaningful set of files", () => expect(all.length).toBeGreaterThan(40));
  it("has no private copy of the fold, sheet, master-detail or action-bar helpers", () => {
    const names = all.map((f) => path.basename(f));
    for (const forbidden of ["dense.tsx", "dense.module.css", "dense-logic.ts", "phone-fold.tsx"]) expect(names, forbidden).not.toContain(forbidden);
  });
  it("opens no private bottom sheet (the shared Sheet is the only one)", () => {
    const offenders = all.filter((f) => /\.(tsx)$/.test(f)).filter((f) => /from\s+["']@\/components\/ui\/sheet["']/.test(readFileSync(path.join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
  it("positions no action bar of its own (fixed bottom bars come from StickyActionBar)", () => {
    const offenders = all.filter((f) => /\.(tsx|css)$/.test(f)).filter((f) => /fixed\s+inset-x-0\s+bottom-0|sticky bottom-0|position:\s*fixed/.test(readFileSync(path.join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
