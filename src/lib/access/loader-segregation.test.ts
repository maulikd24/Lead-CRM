import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Segregation at the data layer, checked in the source tree: customer and RM work must not depend on marketing spend
 * data, and marketing code must not reach for personal customer fields. The runtime counterpart (loaders called as each
 * role against a real database) is loaders.db.test.ts.
 */
const SRC = join(process.cwd(), "src");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "generated" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
};
const files = walk(SRC);
const rel = (f: string) => relative(SRC, f).split("\\").join("/");
const read = (f: string) => readFileSync(f, "utf8");

/** Places that may touch ad spend: the marketing module itself, the scheduler that syncs it, the integration adapters and flags. */
const MAY_TOUCH_SPEND = [/^lib\/marketing\//, /^app\/\(dashboard\)\/command-search-actions\.ts$/ /* Cmd+K: imports only searchCampaignNames (names, no spend); the role is checked again inside it */, /^app\/\(dashboard\)\/marketing\//, /^app\/api\/internal\/cron\/tick\/route\.ts$/, /^lib\/integrations\/adapters\/(google|meta)-ads\.ts$/, /^lib\/nav-flags\.ts$/, /^lib\/system\/status-wiring\.ts$/, /^lib\/access\//, /^app\/\(dashboard\)\/settings\/integrations\//, /^lib\/integrations\//, /^lib\/go-live\//, /^lib\/privacy\//, /^lib\/policy\/approvals\/canonical\/(wiring|adapters\/social-post)\.ts$/ /* the approvals inbox reads and decides social posts through the marketing module's own service; it never selects spend */];

const SPEND_TOKENS = /adCampaignDaily|adCreativeDaily|adSyncRun|spendMinor|\broas\b|costPerLead|cost_per_lead|\bcpl\b|adAccountId|daily_budget|dailyBudget/i;

describe("RM, manager, finance and partner code never touches ad spend", () => {
  it("only the marketing module, its scheduler and its settings reference spend tables or fields", () => {
    const offenders = files.filter((f) => !MAY_TOUCH_SPEND.some((re) => re.test(rel(f))) && SPEND_TOKENS.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
  it("nothing outside the marketing module imports from it (except the nav flag, the scheduler and the integration adapters)", () => {
    const offenders = files
      .filter((f) => !MAY_TOUCH_SPEND.some((re) => re.test(rel(f))))
      .filter((f) => /from "@\/lib\/marketing\//.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
  it("the Client model has no relation to any ad table, so no client query can reach spend", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const client = schema.match(/model Client \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(client.length).toBeGreaterThan(100);
    expect(client).not.toMatch(/\bAd(Campaign|Creative|Sync)\w*\b/);
  });
});

/** Personal fields that must never appear in a marketing loader's query. */
const PERSONAL_SELECTS = /\b(mobile|email|pan|panNumber|aadhaar|dateOfBirth|address|accountNumber|bankAccount)\s*:\s*true/;

describe("marketing loaders select no personal field", () => {
  const marketingLoaders = files.filter((f) => /^lib\/marketing\/(report|creatives-db|attribution|revenue)\.ts$/.test(rel(f)));
  it("finds the loaders (sanity)", () => expect(marketingLoaders.length).toBeGreaterThanOrEqual(3));
  it("select no mobile, email, PAN or similar", () => {
    for (const f of marketingLoaders) expect(read(f), rel(f)).not.toMatch(PERSONAL_SELECTS);
  });
  it("never select the client name", () => {
    for (const f of marketingLoaders) {
      const src = read(f);
      // `name: true` inside a client select would be the customer's name; campaign and ad names are not selects.
      expect(src, rel(f)).not.toMatch(/prisma\.client\.[\s\S]{0,600}\bname:\s*true/);
    }
  });
});
