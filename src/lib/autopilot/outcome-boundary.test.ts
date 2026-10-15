import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Autopilot reads what came of the clicks ONLY from the CampaignOutcomeProvider (lib/attribution). This pins that in the source tree:
 * no spend table, no attribution internals, no private funded, KYC, revenue, cost-per-funded or return-on-spend arithmetic, and no second provider.
 * The one documented exception is regions.ts: a REGION has no provider grain yet (no platform reports spend by region), so a region's cost per
 * funded customer divides the platform's regional spend dataset by the funded count of that region's lead cohort. When regional spend is synced,
 * that moves into the provider and this exception is deleted.
 */
const SRC = join(process.cwd(), "src");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !/\.testkit\.ts$/.test(name)) out.push(full);
  }
  return out;
};
const files = [...walk(join(SRC, "lib/autopilot")), ...walk(join(SRC, "app/(dashboard)/autopilot"))];
const rel = (f: string) => relative(SRC, f).split("\\").join("/");
const read = (f: string) => readFileSync(f, "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Spend or revenue divided by funded customers, KYC approvals or CRM leads (the platform's own lead count, platformLeads, is a platform metric and is not an outcome). Revenue over spend is return on spend. */
const AFTER_CLICK = String.raw`(funded|kyc|crmLeads|\.leads\.length|leads\.filter|leads\.length)`;
export const OUTCOME_ARITHMETIC = new RegExp(String.raw`ratio\(\s*[\w.]*(spend|revenue)[\w.]*\s*,\s*[^)]*${AFTER_CLICK}|(spend|revenue)\s*\/\s*[\w.()]*${AFTER_CLICK}|revenue\s*\/\s*[\w.()]*spend|ratio\(\s*[\w.]*revenue[\w.]*\s*,\s*[\w.()]*spend`, "i");

describe("Autopilot reads outcomes only through the provider", () => {
  it("never touches a spend table or the ad platform sync", () => {
    const offenders = files.filter((f) => /adCampaignDaily|adCreativeDaily|adSyncRun|spendMinor|\.client\.(findMany|findFirst|count)|\.clientPayment\.|\.revenueEvent\.|\.fundingRecord\.|\.kycRecord\./.test(strip(read(f)))).map(rel);
    expect(offenders).toEqual([]);
  });
  it("imports attribution only through its public surface (no internals)", () => {
    const offenders = files.flatMap((f) => [...read(f).matchAll(/from\s+"@\/lib\/attribution\/([\w.-]+)"/g)].map((m) => `${rel(f)} imports attribution/${m[1]}`));
    expect(offenders).toEqual([]);
  });
  it("declares no CampaignOutcomeProvider of its own", () => {
    expect(files.filter((f) => /implements\s+CampaignOutcomeProvider|interface\s+\w*OutcomeProvider|:\s*CampaignOutcomeProvider\s*=\s*\{/.test(read(f))).map(rel)).toEqual([]);
  });
  it("computes no funded, KYC, revenue, cost-per-funded or return-on-spend number (regions.ts excepted, see the header)", () => {
    const offenders = files.filter((f) => !/lib\/autopilot\/regions\.ts$/.test(rel(f)) && OUTCOME_ARITHMETIC.test(strip(read(f)))).map(rel);
    expect(offenders).toEqual([]);
  });
  it("the arithmetic pattern really catches the forms it is meant to catch", () => {
    for (const bad of ["const c = ratio(spend, funded);", "ratio(c.spend, leads.filter((l) => l.funded).length)", "const cpf = spend / funded;", "x = revenue / spend", "ratio(c.revenue, c.spend)", "ratio(spend, crmLeads)"]) expect(OUTCOME_ARITHMETIC.test(bad), bad).toBe(true);
    for (const ok of ["const share = wasted / totalSpend", "ratio(clicks, impressions)", "out?.costPerFunded ?? null", "ratio(spend, platformLeads)"]) expect(OUTCOME_ARITHMETIC.test(ok), ok).toBe(false);
  });
  it("the snapshot is built from provider.outcomes and provider.leadCohorts", () => {
    const store = read(join(SRC, "lib/autopilot/store.ts"));
    expect(store).toMatch(/provider\.outcomes\(/);
    expect(store).toMatch(/provider\.leadCohorts\(/);
    expect(store).toMatch(/getCampaignOutcomeProvider/);
  });
});
