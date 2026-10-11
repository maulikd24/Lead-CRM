/**
 * Real-database check of the data-level rules, calling the real loaders as each role:
 *  - the marketing loaders answer ADMIN and MARKETING, return aggregates only, and no personal field of a seeded customer
 *    (name, phone, email, PAN, holdings) appears anywhere in what they return;
 *  - every other role is refused before a query runs;
 *  - the campaign label an RM may see carries no spend, budget or ad account.
 * Needs a throwaway local Postgres, so it is skipped unless ACCESS_DB_TEST=1 (and refuses any non-local database):
 *   ACCESS_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/access/loaders.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.ACCESS_DB_TEST === "1" && local;

const NAME = "Qvxz Lorrimant";
const PHONE = "9123409876";
const EMAIL = "qvxz.lorrimant@example.test";
const PAN = "QVXZL4321K";
const PROBES = [NAME, "Lorrimant", PHONE, EMAIL, PAN];
const FORBIDDEN_KEYS = ["clientId", "customerId", "mobile", "phone", "email", "pan", "holdings", "clientName", "customerName", "assignedTo", "rm"];

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { out.add(k); keysDeep(v, out); }
  return out;
}

describe.skipIf(!enabled)("loaders called as each role (real database)", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  const dayKey = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    db = (await import("@/lib/db/prisma")).basePrisma;
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "S", sequence: 1 } as never }));
    await db.client.create({ data: { clientCode: "AX-0001", name: NAME, mobile: PHONE, email: EMAIL, pan: PAN, currentStageId: stage.id, leadSource: "Meta", leadAttribution: { source: "meta_leads", campaign: "Festive SIP", campaign_id: "c1", spend: "9999", ad_account_id: "act_7" } } });
    await db.adCampaignDaily.create({ data: { provider: "meta", accountId: "7", campaignId: "c1", campaignName: "Festive SIP", date: new Date(`${dayKey}T00:00:00Z`), spendMinor: BigInt(500000), currency: "INR", impressions: 1000, clicks: 50, reach: 800, leads: 3, accountTimezone: "Asia/Kolkata", syncedAt: new Date() } });
    await db.adSyncRun.create({ data: { provider: "meta", accountId: "7", status: "SUCCESS", startedAt: new Date(), finishedAt: new Date(), rowsUpserted: 1, campaignsSeen: 1, windowsOk: 1, windowsFailed: 0 } as never });
  });
  afterAll(async () => {
    await db.client.deleteMany({ where: { clientCode: "AX-0001" } });
    await db.adCampaignDaily.deleteMany({ where: { accountId: "7" } });
    await db.adSyncRun.deleteMany({ where: { accountId: "7" } });
  });

  it.each(["MARKETING", "ADMIN"] as const)("gives %s the aggregates and no personal field of any customer", async (role) => {
    const { loadMarketingWorkspaceFor } = await import("@/lib/marketing/report");
    const data = await loadMarketingWorkspaceFor(role, (today) => ({ from: today, to: today }) as never);
    const json = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(json.length).toBeGreaterThan(50);
    for (const probe of PROBES) expect(json, probe).not.toContain(probe);
    const keys = keysDeep(JSON.parse(json));
    for (const k of FORBIDDEN_KEYS) expect(keys.has(k), `key ${k}: ${json.match(new RegExp(`.{60}"${k}":.{40}`))?.[0]}`).toBe(false);
  });

  it.each(["RM", "MANAGER", "FINANCE", "DEALER", "PARTNER", "TEAM_MANAGER"] as const)("refuses %s", async (role) => {
    const { loadMarketingWorkspaceFor } = await import("@/lib/marketing/report");
    await expect(loadMarketingWorkspaceFor(role, (today) => ({ from: today, to: today }) as never)).rejects.toThrow(/denied/i);
  });

  it("shows an RM the campaign name on a lead and never the spend, budget or ad account stored beside it", async () => {
    const { leadCampaignRows } = await import("@/lib/access/lead-context");
    const row = await db.client.findFirstOrThrow({ where: { clientCode: "AX-0001" }, select: { leadAttribution: true } });
    const rows = leadCampaignRows("RM", row.leadAttribution);
    expect(rows).toEqual([["campaign", "Festive SIP"]]);
    expect(JSON.stringify(rows)).not.toMatch(/9999|act_7|c1/);
  });

  it("returns a marketing user no customer-owned rows from the visibility rule", async () => {
    const { getVisibleUserIds } = await import("@/lib/auth/visibility");
    expect(await getVisibleUserIds("anyone", "MARKETING")).toEqual([]);
  });
});
