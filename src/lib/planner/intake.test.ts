import { describe, expect, it } from "vitest";

import { routeCampaignLead, type IntakeRouteDeps } from "./intake";

const decision = (over: Partial<{ via: "rule" | "fallback" | "none"; ownerId: string | null }> = {}) => ({ via: "rule" as const, ownerId: "rm-1", ownerLabel: null, rule: null, ...over });
const deps = (over: Partial<IntakeRouteDeps> = {}): IntakeRouteDeps & { seen: unknown[] } => {
  const seen: unknown[] = [];
  return { seen, enabled: () => true, ownerFor: async (code, lead) => { seen.push({ code, lead }); return { decision: decision(), planId: "pl1" }; }, ...over };
};

describe("a lead that arrives with a campaign code goes to the owner the plan's rules name", () => {
  it("reads the code from the attribution and routes by city, language and product", async () => {
    const d = deps();
    const r = await routeCampaignLead({ attribution: { campaign_code: "CP-ABC234" }, city: "Mumbai", language: "Hindi", productInterest: "Portfolio check" }, d);
    expect(r).toEqual({ assignedToId: "rm-1", planId: "pl1", via: "rule", code: "CP-ABC234" });
    expect(d.seen[0]).toEqual({ code: "CP-ABC234", lead: { city: "Mumbai", language: "Hindi", product: "Portfolio check" } });
  });
  it("reads the code from a click-to-WhatsApp first message", async () => {
    const r = await routeCampaignLead({ message: "Hi, check my portfolio (Ref: CP-ABC234)" }, deps());
    expect(r?.code).toBe("CP-ABC234");
  });
  it("does nothing when the planner is off, there is no code, the plan is unknown or no owner is named", async () => {
    expect(await routeCampaignLead({ attribution: { campaign_code: "CP-ABC234" } }, deps({ enabled: () => false }))).toBeNull();
    expect(await routeCampaignLead({ attribution: {} }, deps())).toBeNull();
    expect(await routeCampaignLead({ attribution: { campaign_code: "CP-ABC234" } }, deps({ ownerFor: async () => null }))).toBeNull();
    expect(await routeCampaignLead({ attribution: { campaign_code: "CP-ABC234" } }, deps({ ownerFor: async () => ({ decision: decision({ via: "none", ownerId: null }), planId: "pl1" }) }))).toBeNull();
  });
  it("never fails the intake: an error means the existing assignment decides", async () => {
    expect(await routeCampaignLead({ attribution: { campaign_code: "CP-ABC234" } }, deps({ ownerFor: async () => { throw new Error("db down"); } }))).toBeNull();
  });
});
