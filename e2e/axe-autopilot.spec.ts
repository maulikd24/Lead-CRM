import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./support/fixtures";
import { type RoleKey } from "./support/roles";

/**
 * Accessibility of the Autopilot screens (nightly, projects axe-<role>): every tab for the roles that may open them (ADMIN and MARKETING),
 * at 1440 and 390 wide, in light and dark. wcag2a/aa, 21a/aa, 22aa and best-practice; a serious
 * or critical violation fails the run, moderate and minor are printed. Run it against the flags-on build with the layout-budget seed
 * (`npm run layout-budget:seed`) so the screens have data, not only empty states.
 */
const BLOCKING = new Set(["serious", "critical"]);
const SCREENS: Record<string, string[]> = {
  admin: ["/autopilot", "/autopilot?tab=audit", "/autopilot?tab=actions", "/autopilot?tab=waste", "/autopilot?tab=timing", "/autopilot?tab=pacing", "/autopilot?tab=regions", "/autopilot?tab=auction", "/autopilot?tab=tracking", "/autopilot?tab=launch", "/autopilot?tab=rules", "/autopilot?tab=ask", "/autopilot?tab=digest"],
  marketing: ["/autopilot", "/autopilot?tab=audit", "/autopilot?tab=actions", "/autopilot?tab=waste", "/autopilot?tab=timing", "/autopilot?tab=pacing", "/autopilot?tab=regions", "/autopilot?tab=auction", "/autopilot?tab=tracking", "/autopilot?tab=launch", "/autopilot?tab=rules", "/autopilot?tab=ask", "/autopilot?tab=digest"],
};
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const SCHEMES = ["light", "dark"] as const;

test("axe: Autopilot screens", async ({ page }, info) => {
  const key = info.project.name.replace(/^axe-/, "") as RoleKey;
  const paths = SCREENS[key];
  test.skip(!paths, "no Autopilot screens for this role");
  test.setTimeout(60_000 + paths.length * VIEWPORTS.length * SCHEMES.length * 15_000);

  await page.setViewportSize(VIEWPORTS[0]);
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
        const path = raw;
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
  console.log(`axe autopilot ${key}: ${scanned} scans, ${blocking.length} blocking, ${advisory.length} advisory${advisory.length ? `\n${advisory.join("\n")}` : ""}`);
  expect(scanned, "no Autopilot screen was reachable").toBeGreaterThan(0);
  expect(blocking, "serious or critical accessibility violations on an Autopilot screen").toEqual([]);
});
