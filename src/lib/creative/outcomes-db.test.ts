import { describe, expect, it, vi } from "vitest";

import type { CampaignOutcomeProvider, OutcomeCaller } from "@/lib/attribution";
import { createFakeOutcomeProvider } from "@/lib/attribution/outcome-provider.testkit";

vi.mock("@/lib/marketing/creatives-db", () => ({
  loadAdDeliveryFor: async (role: string) => {
    if (role !== "ADMIN" && role !== "MARKETING") throw new Error("denied by the delivery loader");
    return { report: { currency: "INR", ads: [], totals: { ads: 0, spend: 0, impressions: 0, clicks: 0, leads: 0, ctr: null, cpl: null }, otherCurrencyRows: 0 }, series: [] };
  },
}));

import { loadAdOutcomes, loadCampaignReport } from "./outcomes-db";

/**
 * Creative asks the canonical provider AS THE SIGNED-IN PERSON, never as a registered system consumer, so the provider's own access rule applies on
 * top of the delivery loader's (two doors, so removing either one is caught here).
 */
const spy = () => {
  const seen: OutcomeCaller[] = [];
  const inner = createFakeOutcomeProvider({ clients: [], spend: [] });
  const provider: CampaignOutcomeProvider = { name: "spy", outcomes: async (q, caller) => { seen.push(caller); return inner.outcomes(q, caller); } };
  return { provider, seen };
};
const range = { from: "2027-04-01", to: "2027-04-20" };

describe("creative reads outcomes as the person who asked", () => {
  it("passes the viewer (id and role) to the provider for ad and campaign reports", async () => {
    const { provider, seen } = spy();
    await loadAdOutcomes({ id: "u1", role: "MARKETING" }, range, provider);
    await loadCampaignReport({ id: "u2", role: "ADMIN" }, range, provider);
    expect(seen).toEqual([{ kind: "user", id: "u1", role: "MARKETING" }, { kind: "user", id: "u2", role: "ADMIN" }]);
  });
  it("an RM is refused by the provider itself (the delivery loader is not the only door)", async () => {
    const real = createFakeOutcomeProvider({ clients: [], spend: [] });
    await expect(loadCampaignReport({ id: "rm", role: "RM" }, range, real)).rejects.toThrow(/Not allowed/i);
    await expect(loadAdOutcomes({ id: "rm", role: "RM" }, range, real)).rejects.toThrow();
  });
});
