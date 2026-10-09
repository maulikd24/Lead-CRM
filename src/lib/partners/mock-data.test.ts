import { describe, expect, it } from "vitest";
import { createMockReferralApi, kycGroupMatches, syntheticReferralData } from "./mock-data";
import { ReferralApiError } from "./referral-api";

describe("synthetic referral data", () => {
  const api = createMockReferralApi();
  it("is deterministic", () => {
    expect(JSON.stringify(syntheticReferralData(1))).toBe(JSON.stringify(syntheticReferralData(1)));
    expect(JSON.stringify(syntheticReferralData(1))).not.toBe(JSON.stringify(syntheticReferralData(2)));
  });
  it("contains no real-looking contact or ID data", () => {
    const text = JSON.stringify(syntheticReferralData(1));
    expect(text).not.toMatch(/[A-Z]{5}\d{4}[A-Z]/); // PAN shape
    expect(text).not.toMatch(/@/);
    expect(text).toMatch(/\+91 ?9/); // mobiles use obviously fake blocks
  });
  it("paginates and filters through the same schemas as the live client", async () => {
    const all = await api.listReferrers({ limit: 100 });
    expect(all.total).toBeGreaterThan(30);
    const p1 = await api.listReferrers({ limit: 10, offset: 0 });
    const p2 = await api.listReferrers({ limit: 10, offset: 10 });
    expect(p1.items).toHaveLength(10);
    expect(p1.items[0].id).not.toBe(p2.items[0].id);
    const verified = await api.listReferrers({ limit: 100, kycStatus: "verified" });
    expect(verified.items.length).toBeGreaterThan(0);
    for (const r of verified.items) expect(kycGroupMatches("verified", r.kycStatus)).toBe(true);
    const hit = await api.listReferrers({ search: all.items[3].fullName.split(" ")[0] });
    expect(hit.items.some((r) => r.id === all.items[3].id)).toBe(true);
  });
  it("summary matches the lists", async () => {
    const s = await api.getSummary();
    const all = await api.listReferrers({ limit: 100 });
    expect(s.referrers.total).toBe(all.total);
    expect(s.referrers.active).toBe(all.items.filter((r) => r.status === "ACTIVE").length);
    expect(s.monthly.length).toBeGreaterThanOrEqual(6);
    expect(s.topReferrers.length).toBeGreaterThan(3);
  });
  it("serves detail and 404s for an unknown id", async () => {
    const first = (await api.listReferrers({ limit: 1 })).items[0];
    expect((await api.getReferrer(first.id)).id).toBe(first.id);
    await expect(api.getReferrer("nope")).rejects.toBeInstanceOf(ReferralApiError);
  });
  it("filters referees by referrer and withdrawals by status", async () => {
    const first = (await api.listReferrers({ limit: 1 })).items[0];
    const refs = await api.listReferees({ referrerId: first.id, limit: 100 });
    for (const r of refs.items) expect(r.referrerId).toBe(first.id);
    const w = await api.listWithdrawals({ status: "PAID", limit: 100 });
    for (const i of w.items) expect(i.status).toBe("PAID");
    expect(w.summary?.byStatus.PAID?.count).toBeGreaterThan(0);
  });
  it("pings ok without any network", async () => {
    expect(await api.ping()).toEqual({ ok: true });
  });
});
