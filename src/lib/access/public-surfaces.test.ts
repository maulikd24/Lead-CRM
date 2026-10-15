import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isArea } from "./policy";
import { PAGE_POLICY, PUBLIC_SURFACES, guardIsOpen } from "./surfaces";

/**
 * The only unauthenticated pages beyond sign-in are NAMED public surfaces: each has its own policy entry (what opens it, which controls it
 * carries) and a test that the page's source really carries every control it claims. A new open page without an entry fails here.
 */
const APP = join(process.cwd(), "src/app");
const pageSource = (route: string) => readFileSync(join(APP, route.replace(/^\//, ""), "page.tsx"), "utf8");
const SIGN_IN = new Set(["/", "/login"]);

describe("named public surfaces", () => {
  const openPages = Object.entries(PAGE_POLICY).filter(([route, g]) => guardIsOpen(g) && (g.open === "public" || g.open === "credential") && !SIGN_IN.has(route));
  it("every open page other than sign-in is a registered public surface, and every registered surface is an open page", () => {
    expect(openPages.map(([r]) => r).sort()).toEqual(Object.values(PUBLIC_SURFACES).map((s) => s.page).sort());
  });
  it("each names a real registry area, a credential and the controls it carries", () => {
    for (const [id, s] of Object.entries(PUBLIC_SURFACES)) {
      expect(isArea(s.area), id).toBe(true);
      expect(s.credential.length, id).toBeGreaterThan(10);
      expect(s.controls.length, id).toBeGreaterThanOrEqual(5);
    }
  });
  it("the report share link carries every control it claims, in the page's own source", () => {
    const s = PUBLIC_SURFACES["report-share-link"];
    expect(s.page).toBe("/shared/report/[token]");
    const src = pageSource(s.page);
    const evidence: Record<string, RegExp> = {
      "unguessable-token": /isWellFormedToken\(/,
      expiry: /openShare\(/,
      revocation: /openShare\(/,
      "rate-limit": /rateLimit\(/,
      "no-personal-data": /ReportDocument/,
      "no-index": /robots:\s*\{\s*index:\s*false/,
      "feature-flag": /directorReportsEnabled\(\)/,
      "no-referrer": /referrer:\s*"no-referrer"/,
    };
    for (const control of s.controls) expect(src, `control ${control}`).toMatch(evidence[control]);
  });
  it("the page is tied to the report area, whose export action also gates making a link", () => {
    expect(PUBLIC_SURFACES["report-share-link"].area).toBe("marketing-reports");
  });
});
