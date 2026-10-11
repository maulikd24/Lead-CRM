import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./support/fixtures";
import { type RoleKey } from "./support/roles";

/**
 * Accessibility of the closed-loop screens (nightly, projects axe-<role>): the four tabs and the outbox filters for the roles that may open them, and the Customer 360
 * consent tab (which carries the "why wasn't this customer sent" explainer) for the desk roles, at 1440 and 390 wide, in light and dark. wcag2a/aa, 21a/aa, 22aa and
 * best-practice; a serious or critical violation fails the run, moderate and minor are printed. Run it against the flags-on build with the layout-budget seed.
 */
const BLOCKING = new Set(["serious", "critical"]);
const TABS = ["/closed-loop", "/closed-loop?tab=outbox", "/closed-loop?tab=outbox&status=dead", "/closed-loop?tab=outbox&status=skipped", "/closed-loop?tab=destinations", "/closed-loop?tab=coverage"];
const SCREENS: Record<string, string[]> = {
  admin: [...TABS, "/clients/{BUSY}/360?tab=consent"],
  marketing: TABS,
  manager: ["/clients/{BUSY}/360?tab=consent"],
  rm: ["/clients/{BUSY}/360?tab=consent"],
};
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const SCHEMES = ["light", "dark"] as const;

test("axe: closed-loop screens", async ({ page }, info) => {
  const key = info.project.name.replace(/^axe-/, "") as RoleKey;
  const paths = SCREENS[key];
  test.skip(!paths, "no closed-loop screens for this role");
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
  console.log(`axe closed loop ${key}: ${scanned} scans, ${blocking.length} blocking, ${advisory.length} advisory${advisory.length ? `\n${advisory.join("\n")}` : ""}`);
  expect(scanned, "no closed-loop screen was reachable").toBeGreaterThan(0);
  expect(blocking, "serious or critical accessibility violations on a closed-loop screen").toEqual([]);
});
