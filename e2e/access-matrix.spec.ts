import { can } from "../src/lib/access/policy";
import { API_POLICY, PAGE_POLICY, guardIsOpen } from "../src/lib/access/surfaces";
import { resolveWorkspaceHome } from "../src/lib/policy/workspace";
import { expect, test } from "./support/fixtures";
import { openAndSettle } from "./support/redirect";
import { ROLES, type RoleKey } from "./support/roles";

/**
 * The access matrix, generated from the registry (src/lib/access/surfaces.ts + policy.ts), which is the oracle:
 * for the signed-in role of this project, every page the registry guards either opens (allowed) or sends the person to their
 * own home (denied; a redirect is read from the document, see support/redirect.ts); every guarded API route either answers or refuses (401/403/404, or a redirect). Pages and routes with a
 * dynamic segment are covered by the flows; server actions by the unit-level surface-coverage test.
 */
const roleKey = (): RoleKey => test.info().project.name as RoleKey;

/** Pages the registry opens to a role that still answer 404 because the page needs data of its own (a partner profile). */
const NOT_FOUND_FOR_NON_OWNERS = new Set(["/partner-home"]);

const pages = Object.entries(PAGE_POLICY).filter(([path, g]) => !path.includes("[") && !guardIsOpen(g));
const apis = Object.entries(API_POLICY).filter(([path, g]) => !path.includes("[") && !guardIsOpen(g));

test.describe("pages", () => {
  for (const [path, g] of pages) {
    if (guardIsOpen(g)) continue;
    test(`${path}`, async ({ page }) => {
      const key = roleKey();
      const { role } = ROLES[key];
      const allowed = can(role, g.area, g.action ?? "view");
      const { status, landedOn } = await openAndSettle(page, path);
      if (allowed) {
        expect(landedOn, `${key} should stay on ${path}`).toBe(path);
        if (!NOT_FOUND_FOR_NON_OWNERS.has(path)) expect(status, `${key} should open ${path}`).toBeLessThan(400);
      } else {
        expect(landedOn, `${key} must be sent to their own home from ${path}`).toBe(resolveWorkspaceHome(role));
      }
    });
  }
});

test.describe("api routes", () => {
  for (const [path, g] of apis) {
    if (guardIsOpen(g)) continue;
    test(`GET ${path}`, async ({ request }) => {
      const key = roleKey();
      const { role } = ROLES[key];
      const allowed = can(role, g.area, g.action ?? "view");
      const res = await request.get(path, { maxRedirects: 0, timeout: 20_000 });
      const status = res.status();
      if (allowed) expect([401, 403], `${key} should be let into ${path}`).not.toContain(status);
      else expect([301, 302, 303, 307, 308, 401, 403, 404, 405], `${key} must be refused ${path}`).toContain(status);
    });
  }
});
