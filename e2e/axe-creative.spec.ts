import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./support/fixtures";
import { type RoleKey } from "./support/roles";

/**
 * Accessibility of the creative intelligence and director report screens (nightly, projects axe-<role>): Insights, Briefs, Experiments, Competitors
 * and Reports for the roles that may open them, the printable report page, and the shared report page (no sign-in needed, opened with the seeded
 * token), at 1440 and 390 wide, in light and dark. wcag2a/aa, 21a/aa, 22aa and best-practice; a serious or critical violation fails the run,
 * moderate and minor are printed. Run it against the flags-on build with the layout-budget seed (`npm run layout-budget:seed`) so the screens have
 * data, not only empty states.
 */
const BLOCKING = new Set(["serious", "critical"]);
/** The known token the creative seed gives its open share link (scripts/layout-budget/seed-creative.ts). Synthetic, local databases only. */
const AXE_SHARE_TOKEN = "axeSeedShareToken".padEnd(43, "x");
const TABS = ["/marketing?tab=intel", "/marketing?tab=briefs", "/marketing?tab=experiments", "/marketing?tab=competitors", "/marketing?tab=reports", "/report-print"];
const SCREENS: Record<string, string[]> = {
  admin: [...TABS, `/shared/report/${AXE_SHARE_TOKEN}`],
  marketing: [...TABS, `/shared/report/${AXE_SHARE_TOKEN}`],
};
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const SCHEMES = ["light", "dark"] as const;

test("axe: creative and report screens", async ({ page }, info) => {
  const key = info.project.name.replace(/^axe-/, "") as RoleKey;
  const paths = SCREENS[key];
  test.skip(!paths, "no creative or report screens for this role");
  test.setTimeout(60_000 + paths.length * VIEWPORTS.length * SCHEMES.length * 15_000);
  await page.emulateMedia({ reducedMotion: "reduce" });

  const blocking: string[] = [];
  const advisory: string[] = [];
  let scanned = 0;
  for (const scheme of SCHEMES) {
    await page.addInitScript((t) => window.localStorage.setItem("theme", t), scheme);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const path of paths) {
        await page.goto(path, { waitUntil: "load" });
        if (new URL(page.url()).pathname !== path.split("?")[0]) continue; // flag off or redirected: nothing to scan
        await page.waitForLoadState("networkidle");
        const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
        scanned++;
        for (const v of violations) {
          const line = `${path.replace(AXE_SHARE_TOKEN, "<token>")} ${viewport.width}px ${scheme} :: ${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}`;
          (BLOCKING.has(v.impact ?? "") ? blocking : advisory).push(line);
        }
      }
    }
  }
  console.log(`axe creative ${key}: ${scanned} scans, ${blocking.length} blocking, ${advisory.length} advisory${advisory.length ? `\n${advisory.join("\n")}` : ""}`);
  expect(scanned, "no creative or report screen was reachable").toBeGreaterThan(0);
  expect(blocking, "serious or critical accessibility violations on a creative or report screen").toEqual([]);
});
