import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { can } from "../src/lib/access/policy";
import { PAGE_POLICY, guardIsOpen } from "../src/lib/access/surfaces";
import { landingFor } from "../src/lib/policy/workspace";
import { expect, test } from "./support/fixtures";
import { ROLES, type RoleKey } from "./support/roles";

/**
 * Accessibility (nightly, project axe-<role>): every static page the registry opens to the role, plus their landing page.
 * Fails on a NEW `serious` or `critical` violation. Violations that already existed when this check was added are listed in
 * ci/axe-baseline.json (a ratchet like the lint baseline: it can only shrink); `moderate` and `minor` are printed and tracked,
 * not blocking. Runs against the flags-on build so every feature screen is present.
 * AXE_WRITE_BASELINE=1 writes what was found to e2e/.axe/<role>.json; `node scripts/ci/axe-baseline.mjs` merges those files.
 */
const BLOCKING = new Set(["serious", "critical"]);

/** Every screen is scanned in both themes and on a laptop and a phone viewport (AXE_VARIANTS=light-laptop,dark-phone narrows it). */
const VARIANTS = [
  { name: "light-laptop", theme: "light", viewport: { width: 1440, height: 900 } },
  { name: "dark-laptop", theme: "dark", viewport: { width: 1440, height: 900 } },
  { name: "light-phone", theme: "light", viewport: { width: 390, height: 844 } },
  { name: "dark-phone", theme: "dark", viewport: { width: 390, height: 844 } },
].filter((v) => !process.env.AXE_VARIANTS || process.env.AXE_VARIANTS.split(",").includes(v.name));

const roleKey = (name: string) => name.replace(/^axe-/, "") as RoleKey;

test("axe: every screen this role can open, light and dark, laptop and phone", async ({ browser }, info) => {
  const key = roleKey(info.project.name);
  const { role } = ROLES[key];
  const paths = Object.entries(PAGE_POLICY)
    .filter(([p, g]) => !p.includes("[") && !guardIsOpen(g) && can(role, g.area, g.action ?? "view"))
    .map(([p]) => p);
  if (!paths.includes(landingFor(role))) paths.unshift(landingFor(role));
  test.setTimeout(60_000 + paths.length * VARIANTS.length * 20_000);

  const baseline = new Set<string>((JSON.parse(readFileSync("ci/axe-baseline.json", "utf8")).violations?.[key] ?? []) as string[]);
  const found = new Set<string>(); // '<path> :: <rule>' over every variant of this role (a baseline entry covers all variants)
  const detail: Record<string, unknown[]> = {};
  const blocking: string[] = [];
  const advisory: string[] = [];
  for (const variant of VARIANTS) {
    // A fresh context per variant (the role's saved session, the viewport, and next-themes' storage key set before first paint).
    const context = await browser.newContext({ storageState: info.project.use.storageState as string, viewport: variant.viewport, reducedMotion: "reduce" }); // a fade-in caught mid-way reads as low contrast: a false positive
    await context.addInitScript((t) => localStorage.setItem("theme", t), variant.theme);
    let current = await context.newPage();
    for (const path of paths) {
      const scan = async (p: Page) => {
        await p.goto(path, { waitUntil: "load" });
        if (new URL(p.url()).pathname !== path) return null; // not available (flag off) or redirected: nothing to scan
        return (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations;
      };
      let violations;
      try {
        violations = await scan(current);
      } catch (e) {
        if (!/crash/i.test(String(e))) throw e;
        current = await context.newPage(); // a renderer crash (memory pressure on a small runner) loses the tab, not the run
        violations = await scan(current);
      }
      if (!violations) continue;
      for (const v of violations) {
        const id = `${path} :: ${v.id}`;
        const line = `[${variant.name}] ${id} (${v.impact}) x${v.nodes.length}: ${v.help}`;
        if (!BLOCKING.has(v.impact ?? "")) advisory.push(line);
        else {
          found.add(id);
          if (!baseline.has(id)) blocking.push(line);
          if (process.env.AXE_DETAIL === "1") {
            (detail[variant.name] ??= []).push({
              id, impact: v.impact, nodes: v.nodes.map((n) => ({ target: n.target, html: n.html.slice(0, 220), why: n.any[0]?.message ?? n.failureSummary?.slice(0, 240) })),
            });
          }
        }
      }
    }
    await context.close();
  }
  const fixed = [...baseline].filter((b) => !found.has(b));
  if (process.env.AXE_WRITE_BASELINE === "1" || process.env.AXE_DETAIL === "1") mkdirSync("e2e/.axe", { recursive: true });
  if (process.env.AXE_WRITE_BASELINE === "1") writeFileSync(`e2e/.axe/${key}.json`, JSON.stringify([...found].sort(), null, 2));
  if (process.env.AXE_DETAIL === "1") writeFileSync(`e2e/.axe/detail-${key}.json`, JSON.stringify(detail, null, 1));
  if (fixed.length) console.log(`axe ${key}: ${fixed.length} baseline entries no longer occur; remove them from ci/axe-baseline.json:\n${fixed.join("\n")}`);
  if (advisory.length) test.info().annotations.push({ type: "axe moderate/minor", description: advisory.join("\n") });
  console.log(`axe ${key}: ${paths.length} screens x ${VARIANTS.length} variants, ${blocking.length} blocking, ${advisory.length} advisory${advisory.length ? `\n${advisory.join("\n")}` : ""}`);
  expect(blocking, "NEW serious or critical accessibility violations (not in ci/axe-baseline.json)").toEqual([]);
  // Ratchet both ways: a fixed violation has to leave the baseline (only when every variant ran, so a narrowed run cannot trip it).
  if (!process.env.AXE_VARIANTS) expect(fixed, "baseline entries that no longer occur: remove them from ci/axe-baseline.json").toEqual([]);
});
