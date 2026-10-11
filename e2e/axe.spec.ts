import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";

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

test("axe: every screen this role can open", async ({ page }, info) => {
  const key = info.project.name.replace(/^axe-/, "") as RoleKey;
  const { role } = ROLES[key];
  const paths = Object.entries(PAGE_POLICY)
    .filter(([p, g]) => !p.includes("[") && !guardIsOpen(g) && can(role, g.area, g.action ?? "view"))
    .map(([p]) => p);
  if (!paths.includes(landingFor(role))) paths.unshift(landingFor(role));
  test.setTimeout(60_000 + paths.length * 20_000);

  await page.emulateMedia({ reducedMotion: "reduce" }); // a fade-in caught mid-way reads as low contrast: a false positive
  const baseline = new Set<string>((JSON.parse(readFileSync("ci/axe-baseline.json", "utf8")).violations?.[key] ?? []) as string[]);
  const found = new Set<string>();
  const blocking: string[] = [];
  const advisory: string[] = [];
  let current = page;
  for (const path of paths) {
    const scan = async (p: typeof page) => {
      await p.goto(path, { waitUntil: "load" });
      if (new URL(p.url()).pathname !== path) return null; // not available (flag off) or redirected: nothing to scan
      return (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations;
    };
    let violations;
    try {
      violations = await scan(current);
    } catch (e) {
      if (!/crash/i.test(String(e))) throw e;
      current = await page.context().newPage(); // a renderer crash (memory pressure on a small runner) loses the tab, not the run
      violations = await scan(current);
    }
    if (!violations) continue;
    for (const v of violations) {
      const id = `${path} :: ${v.id}`;
      const line = `${id} (${v.impact}) x${v.nodes.length}: ${v.help}`;
      if (!BLOCKING.has(v.impact ?? "")) advisory.push(line);
      else {
        found.add(id);
        if (!baseline.has(id)) blocking.push(line);
      }
    }
  }
  const fixed = [...baseline].filter((b) => !found.has(b));
  if (process.env.AXE_WRITE_BASELINE === "1") {
    mkdirSync("e2e/.axe", { recursive: true });
    writeFileSync(`e2e/.axe/${key}.json`, JSON.stringify([...found].sort(), null, 2));
  }
  if (fixed.length) console.log(`axe ${key}: ${fixed.length} baseline entries no longer occur; remove them from ci/axe-baseline.json:\n${fixed.join("\n")}`);
  if (advisory.length) test.info().annotations.push({ type: "axe moderate/minor", description: advisory.join("\n") });
  console.log(`axe ${key}: ${paths.length} screens, ${blocking.length} blocking, ${advisory.length} advisory${advisory.length ? `\n${advisory.join("\n")}` : ""}`);
  expect(blocking, "NEW serious or critical accessibility violations (not in ci/axe-baseline.json)").toEqual([]);
});
