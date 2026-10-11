import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The CampaignOutcomeProvider is the ONLY way another module reads marketing outcomes (spend, leads, contacted in time, KYC, funded, revenue by
 * campaign, ad and period). This pins the boundary in the source tree: no second provider, no private funded or cost-per-lead arithmetic, no deep
 * import of attribution's internals. A module that needs a number the provider does not carry adds it to the provider.
 */
const SRC = join(process.cwd(), "src");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "generated" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !/\.testkit\.ts$/.test(name)) out.push(full);
  }
  return out;
};
const files = walk(SRC);
const rel = (f: string) => relative(SRC, f).split("\\").join("/");
const read = (f: string) => readFileSync(f, "utf8");

/** Where attribution's internals may be imported from: itself and the screens that render its own tabs. */
const INSIDE = [/^lib\/attribution\//, /^components\/attribution\//, /^app\/\(dashboard\)\/marketing\//, /^app\/\(dashboard\)\/settings\/lead-leakage\//];
/** The public surface of lib/attribution for every other module. */
const PUBLIC = new Set(["flag", "events", "job", "outcome-provider", "outcome-provider-db", "outcome-provider.testkit"]);

describe("one outcome provider", () => {
  it("declares the CampaignOutcomeProvider interface exactly once, in lib/attribution", () => {
    const declares = files.filter((f) => /\b(interface|class)\s+\w*CampaignOutcomeProvider\b|\btype\s+\w*CampaignOutcomeProvider\s*=/.test(read(f)) && !/^lib\/attribution\/outcome-provider\.ts$/.test(rel(f)));
    expect(declares.map(rel)).toEqual([]);
    expect(read(join(SRC, "lib/attribution/outcome-provider.ts"))).toMatch(/export interface CampaignOutcomeProvider/);
  });
  it("no other module implements it (a second implementation is a second definition of funded)", () => {
    const implementers = files.filter((f) => /implements\s+CampaignOutcomeProvider|:\s*CampaignOutcomeProvider\s*=\s*\{/.test(read(f)) && !/^lib\/attribution\//.test(rel(f)));
    expect(implementers.map(rel)).toEqual([]);
  });
});

describe("other modules read outcomes only through the provider", () => {
  it("nothing outside attribution and its own screens imports its internals", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (INSIDE.some((re) => re.test(rel(f)))) continue;
      for (const m of read(f).matchAll(/from\s+"@\/lib\/attribution(?:\/([\w.-]+))?"/g)) {
        const leaf = m[1] ?? "index";
        if (!PUBLIC.has(leaf) && leaf !== "index") offenders.push(`${rel(f)} imports attribution/${leaf}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it("only the provider, the marketing module and the attribution screens read ad spend or compute cost per lead and funded rates", () => {
    const ALLOWED = [/^lib\/attribution\//, /^lib\/marketing\//, /^app\/\(dashboard\)\/marketing\//, /^app\/\(dashboard\)\/settings\/lead-leakage\//, /^app\/api\/internal\/cron\/tick\/route\.ts$/, /^lib\/integrations\/adapters\/(google|meta)-ads\.ts$/, /^lib\/nav-flags\.ts$/, /^lib\/system\//];
    // Spend TABLES are read only by the places above. The provider's own vocabulary (cost per lead, cost per funded customer) may also be READ off a
    // provider row by a registered consumer; that the consumer never COMPUTES it is pinned by that consumer's own boundary test (lib/autopilot/outcome-boundary.test.ts).
    const CONSUMERS = [/^lib\/autopilot\//, /^app\/\(dashboard\)\/autopilot\//];
    const TABLE_TOKENS = /adCampaignDaily|adCreativeDaily|spendMinor/;
    const METRIC_TOKENS = /costPerLead|costPerFunded|cost_per_lead/;
    const offenders = files.filter((f) => !ALLOWED.some((re) => re.test(rel(f))) && (TABLE_TOKENS.test(read(f)) || (!CONSUMERS.some((re) => re.test(rel(f))) && METRIC_TOKENS.test(read(f))))).map(rel);
    expect(offenders).toEqual([]);
  });
});
