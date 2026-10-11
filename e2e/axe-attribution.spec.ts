import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./support/fixtures";
import { type RoleKey } from "./support/roles";

/**
 * Accessibility of the attribution screens (nightly, projects axe-<role>): Campaign impact and Lead leakage for the roles that may open them,
 * the Journey tab for the desk roles, each tab, at 1440 and 390 wide, in light and dark. wcag2a/aa, 21a/aa, 22aa and best-practice; a serious
 * or critical violation fails the run, moderate and minor are printed. Run it against the flags-on build with the layout-budget seed
 * (`npm run layout-budget:seed`) so the screens have data, not only empty states.
 */
const BLOCKING = new Set(["serious", "critical"]);
const SCREENS: Record<string, string[]> = {
  admin: ["/marketing?tab=impact", "/marketing?tab=impact&compare=1", "/settings/lead-leakage", "/settings/lead-leakage?tab=settings", "/clients/{BUSY}/360?tab=journey"],
  marketing: ["/marketing?tab=impact", "/marketing?tab=impact&compare=1", "/settings/lead-leakage", "/settings/lead-leakage?tab=settings"],
  manager: ["/clients/{BUSY}/360?tab=journey"],
  rm: ["/clients/{BUSY}/360?tab=journey"],
};
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const SCHEMES = ["light", "dark"] as const;

test("axe: attribution screens", async ({ page }, info) => {
  const key = info.project.name.replace(/^axe-/, "") as RoleKey;
  const paths = SCREENS[key];
  test.skip(!paths, "no attribution screens for this role");
  test.setTimeout(60_000 + paths.length * VIEWPORTS.length * SCHEMES.length * 15_000);

  await page.setViewportSize(VIEWPORTS[0]);
  let busy = "none";
  if (paths.some((p) => p.includes("{BUSY}"))) {
    await page.goto("/clients?q=LB-001", { waitUntil: "load" });
    const href = await page.locator('a[href^="/clients/c"]').first().getAttribute("href", { timeout: 10_000 }).catch(() => null);
    busy = href?.split("/")[2]?.split("?")[0] ?? "none";
  }
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
        const path = raw.replace("{BUSY}", busy);
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
  console.log(`axe attribution ${key}: ${scanned} scans, ${blocking.length} blocking, ${advisory.length} advisory${advisory.length ? `\n${advisory.join("\n")}` : ""}`);
  expect(scanned, "no attribution screen was reachable").toBeGreaterThan(0);
  expect(blocking, "serious or critical accessibility violations on an attribution screen").toEqual([]);
});
