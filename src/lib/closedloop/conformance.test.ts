import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The closed loop's conformance to the shared foundation, pinned in the source: central access (no private role list, no private guard), outcomes only through the
 * provider, one vendor-hash module, no private pseudonymiser, jobs through runJob. A violation fails the build; the foundation owns these rules, not this module.
 */
const SRC = join(process.cwd(), "src");
const MODULE = join(SRC, "lib/closedloop");
const SCREENS = join(SRC, "app/(dashboard)/closed-loop");
const list = (dir: string) => readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !/\.testkit\.ts$/.test(f)).map((f) => ({ name: f, src: readFileSync(join(dir, f), "utf8") }));
const lib = list(MODULE);
const screens = list(SCREENS);
const all = [...lib.map((f) => ({ ...f, name: `lib/closedloop/${f.name}` })), ...screens.map((f) => ({ ...f, name: `app/closed-loop/${f.name}` }))];

describe("access: the central registry decides, nothing in the module does", () => {
  it("has no private access file and no role literal anywhere in the module or its screens", () => {
    expect(lib.map((f) => f.name)).not.toContain("access.ts");
    const ROLES = /["'](ADMIN|MARKETING|RM|MANAGER|FINANCE|DEALER|TEAM_MANAGER|PARTNER|AFFILIATE|DISTRIBUTOR)["']/;
    expect(all.filter((f) => ROLES.test(f.src)).map((f) => f.name)).toEqual([]);
  });
  it("no page or action uses requireRole, requireUser, auth() or canAccessMarketing itself: they call requireMarketing on the marketing-attribution area", () => {
    for (const f of screens.filter((s) => /^(page|actions)\.tsx?$/.test(s.name))) {
      expect(f.src, f.name).not.toMatch(/requireRole\(|requireUser\(|\bauth\(\)|canAccessMarketing/);
      expect(f.src, f.name).toMatch(/requireMarketing\("marketing-attribution"/);
    }
  });
});

describe("one hash module, one pseudonymiser", () => {
  it("createHash appears only in the vendor-hash module and the dedup id (both must be unkeyed and stable: the platform matches and deduplicates on them)", () => {
    expect(all.filter((f) => /createHash|createHmac/.test(f.src)).map((f) => f.name).sort()).toEqual(["lib/closedloop/events.ts", "lib/closedloop/hashing.ts"]);
  });
  it("no pseudonymiser of its own: a stand-in for a person is `pseudonymize` from the access module or nothing", () => {
    expect(all.filter((f) => /function\s+\w*pseudonym\w*|const\s+\w*pseudonym\w*\s*=/i.test(f.src)).map((f) => f.name)).toEqual([]);
  });
});

describe("outcomes only through the provider", () => {
  it("the screens and loaders never count funded customers or read ad tables themselves", () => {
    const FORBIDDEN = /fundingRecord|FundingRecord|adCampaignDaily|adCreativeDaily|costPerLead|costPerFunded|leadAttribution->>'campaign'/;
    const offenders = all.filter((f) => ["lib/closedloop/views-db.ts", "lib/closedloop/outcomes.ts", "app/closed-loop/coverage-tab.tsx", "app/closed-loop/overview-tab.tsx", "app/closed-loop/outbox-tab.tsx"].includes(f.name) && FORBIDDEN.test(f.src));
    expect(offenders.map((f) => f.name)).toEqual([]);
    const cov = all.find((f) => f.name === "app/closed-loop/coverage-tab.tsx")!.src;
    expect(cov).toMatch(/getCampaignOutcomeProvider/);
    expect(all.find((f) => f.name === "lib/closedloop/outcomes.ts")!.src).toMatch(/consumer: "closed-loop"/);
  });
});

describe("jobs and events go through the foundation", () => {
  it("the cron tick runs the drain through runJob under its registered key", () => {
    const tick = readFileSync(join(SRC, "app/api/internal/cron/tick/route.ts"), "utf8");
    expect(tick).toMatch(/runJob\("closed-loop-conversions"/);
  });
  it("send results and intake use the canonical emit and consumer layers, not a table of their own", () => {
    const results = lib.find((f) => f.name === "results-events.ts")!.src;
    expect(results).toMatch(/events\/producers-emit/);
    expect(lib.find((f) => f.name === "intake.ts")!.src).toMatch(/events\/consumers/);
    expect(all.filter((f) => /customerEvent\.(create|upsert|createMany)/.test(f.src)).map((f) => f.name)).toEqual([]);
  });
});
