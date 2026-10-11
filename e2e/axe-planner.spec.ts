import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./support/fixtures";
import { type RoleKey } from "./support/roles";

/**
 * Accessibility of the planner screens (nightly, projects axe-<role>): the board, calendar and every registry tab, the editors open in their
 * sheets, and one plan's sections, at 1440 and 390 wide, in light and dark. wcag2a/aa, 21a/aa, 22aa and best-practice; a serious or critical
 * violation fails the run, moderate and minor are printed. Run it against the flags-on build with some planner data so the screens are not only empty states.
 */
const BLOCKING = new Set(["serious", "critical"]);
const TABS = ["", "calendar", "promises", "audiences", "destinations", "creators", "routing"].map((t) => (t ? `/planner?tab=${t}` : "/planner"));
const PLAN = ["/planner/{PLAN}", "/planner/{PLAN}?tab=links", "/planner/{PLAN}?tab=copy", "/planner/{PLAN}?tab=funnel", "/planner/{PLAN}?tab=history", "/planner/{PLAN}?edit=1"];
const SCREENS: Record<string, string[]> = {
  admin: [...TABS, "/planner?new=1", "/planner?tab=destinations&edit=new", "/planner?tab=creators&edit=new", "/planner?tab=routing&edit=new", "/planner?tab=promises&edit=new", "/planner?tab=audiences&edit=new", ...PLAN],
  marketing: [...TABS, "/planner?new=1", "/planner?tab=promises&edit=new", ...PLAN],
};
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const SCHEMES = ["light", "dark"] as const;

test("axe: planner screens", async ({ page }, info) => {
  const key = info.project.name.replace(/^axe-/, "") as RoleKey;
  const paths = SCREENS[key];
  test.skip(!paths, "no planner screens for this role");
  test.setTimeout(60_000 + paths.length * VIEWPORTS.length * SCHEMES.length * 15_000);

  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto("/planner", { waitUntil: "load" });
  const href = await page.locator('a[href^="/planner/c"]').first().getAttribute("href", { timeout: 10_000 }).catch(() => null);
  const plan = href?.split("/")[2]?.split("?")[0] ?? null;
  await page.emulateMedia({ reducedMotion: "reduce" });

  const blocking: string[] = [];
  const advisory: string[] = [];
  let scanned = 0;
  for (const scheme of SCHEMES) {
    await page.addInitScript((t) => window.localStorage.setItem("theme", t), scheme);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const raw of paths) {
        if (raw.includes("{PLAN}") && !plan) continue;
        const path = raw.replace("{PLAN}", plan ?? "none");
        await page.goto(path, { waitUntil: "load" });
        if (new URL(page.url()).pathname !== path.split("?")[0]) continue; // flag off or redirected: nothing to scan
        await page.waitForLoadState("networkidle");
        const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
        scanned++;
        for (const v of violations) {
          const line = `${raw} ${viewport.width}px ${scheme} :: ${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}`;
          (BLOCKING.has(v.impact ?? "") ? blocking : advisory).push(line);
        }
      }
    }
  }
  console.log(`axe planner ${key}: ${scanned} scans, ${blocking.length} blocking, ${advisory.length} advisory${advisory.length ? `\n${advisory.join("\n")}` : ""}`);
  expect(scanned, "no planner screen was reachable").toBeGreaterThan(0);
  expect(blocking, "serious or critical accessibility violations on a planner screen").toEqual([]);
});
