import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The registry has one door. Product facts come out through cite() / listCitable() / listApprovedClaims() (lib/registry/service.ts), which refuse
 * anything that is not approved and in date. Nothing else in the app may read the registry tables directly, or an agent, the campaign planner
 * or a copy tool could quote a draft, a suspended or a retired product. This scans the source tree for the table names.
 */
const SRC = join(process.cwd(), "src");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "generated" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
};
const rel = (f: string) => relative(SRC, f).split("\\").join("/");
const ALLOWED = [/^lib\/registry\//, /^app\/\(dashboard\)\/settings\/product-registry\//];
const TOKENS = /registryProduct|RegistryProduct/;

describe("the product registry is read only through cite()", () => {
  it("no file outside lib/registry and the Admin registry screens touches the registry tables", () => {
    const offenders = walk(SRC).filter((f) => !ALLOWED.some((re) => re.test(rel(f))) && TOKENS.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });
  it("the read-only RM page and the Marketing page go through the service, not the tables", () => {
    for (const f of ["app/(dashboard)/product-registry/page.tsx", "app/(dashboard)/marketing/approved-claims/page.tsx"]) {
      const text = readFileSync(join(SRC, f), "utf8");
      expect(text, f).toMatch(/from "@\/lib\/registry\/service"/);
      expect(text, f).not.toMatch(/prisma/);
    }
  });
});
