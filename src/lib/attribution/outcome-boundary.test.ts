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
  const ALLOWED = [/^lib\/attribution\//, /^lib\/marketing\//, /^app\/\(dashboard\)\/marketing\//, /^app\/\(dashboard\)\/settings\/lead-leakage\//, /^app\/api\/internal\/cron\/tick\/route\.ts$/, /^lib\/integrations\/adapters\/(google|meta)-ads\.ts$/, /^lib\/nav-flags\.ts$/, /^lib\/system\//];
  it("only the provider, the marketing module and the attribution screens read ad spend tables or the raw spend field", () => {
    const TOKENS = /adCampaignDaily|adCreativeDaily|spendMinor|cost_per_lead/;
    const offenders = files.filter((f) => !ALLOWED.some((re) => re.test(rel(f))) && TOKENS.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
  it("no other module computes a cost or return figure: a consumer may READ the provider's costPerLead, costPerFunded and roas fields, never divide spend", () => {
    // `spend / leads`, `x / spend`, `spend * 1 / n`: any division with a spend operand. Comments and strings are stripped first.
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, "``");
    const DIVIDES_SPEND = /\b\w*[sS]pend\w*\s*\)?\s*\/\s*[\w(]|[\w)]\s*\/\s*\(?\w*[sS]pend\w*\b/;
    const offenders = files.filter((f) => !ALLOWED.some((re) => re.test(rel(f))) && DIVIDES_SPEND.test(strip(read(f)))).map(rel);
    expect(offenders).toEqual([]);
  });
});
