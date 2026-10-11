import { describe, expect, it, vi } from "vitest";

import type { EmitInput } from "@/lib/events/envelope";

import { emitCampaignFundedFor, leadClockConsumer, type FundedDeps } from "./events";
import type { Attribution, Touch } from "./model";

const FUNDED_AT = new Date("2027-03-05T10:00:00Z");
const touch: Touch = { kind: "meta_ad", at: "2027-03-01T10:00:00Z", creative: "c", form: null, code: null, confidence: "high", rule: "campaign_id", campaign: { key: "meta:111", id: "111", name: "Retirement" , inSpendData: true }, why: "x" };
const attributed: Attribution = { status: "attributed", first: touch, last: touch, touches: [touch], confidence: "high", reason: null, reasonText: null };
const unattributed: Attribution = { status: "unattributed", first: null, last: null, touches: [], confidence: null, reason: "no_markers", reasonText: "none" };

const deps = (over: Partial<FundedDeps> = {}) => {
  const emitted: (EmitInput | null)[] = [];
  const d: FundedDeps = { enabled: () => true, attribution: async () => attributed, emit: async (i) => void emitted.push(i), ...over };
  return { d, emitted };
};

describe("campaign.funded.attributed", () => {
  it("is emitted for a funded customer whose first touch names a campaign, by campaign id (never the title), through the one emit path", async () => {
    const { d, emitted } = deps();
    await emitCampaignFundedFor({ clientId: "c1", status: "FULLY_FUNDED", fundedAt: FUNDED_AT }, d);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: "campaign.funded.attributed", clientId: "c1", metadata: { campaignId: "111", provider: "meta_ad", confidence: "high" } });
    expect(JSON.stringify(emitted[0])).not.toContain("Retirement");
  });
  it("is silent for an unattributed customer, a not-funded status, or a first touch with no campaign", async () => {
    for (const [attribution, status] of [[unattributed, "FULLY_FUNDED"], [attributed, "PENDING"], [{ ...attributed, first: { ...touch, campaign: null } } as Attribution, "FULLY_FUNDED"]] as const) {
      const { d, emitted } = deps({ attribution: async () => attribution });
      await emitCampaignFundedFor({ clientId: "c1", status, fundedAt: FUNDED_AT }, d);
      expect(emitted.filter(Boolean)).toHaveLength(0);
    }
  });
  it("does not even look up the attribution while a flag is off", async () => {
    const attribution = vi.fn(async () => attributed);
    const { d, emitted } = deps({ enabled: () => false, attribution });
    await emitCampaignFundedFor({ clientId: "c1", status: "FULLY_FUNDED", fundedAt: FUNDED_AT }, d);
    expect(attribution).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(0);
  });
  it("never throws into the funding transition", async () => {
    const { d } = deps({ attribution: async () => { throw new Error("db down"); } });
    await expect(emitCampaignFundedFor({ clientId: "c1", status: "FULLY_FUNDED", fundedAt: FUNDED_AT }, d)).resolves.toBeUndefined();
    const { d: d2 } = deps({ emit: async () => { throw new Error("emit down"); } });
    await expect(emitCampaignFundedFor({ clientId: "c1", status: "FULLY_FUNDED", fundedAt: FUNDED_AT }, d2)).resolves.toBeUndefined();
  });
});

describe("the lead clock consumer", () => {
  const ev = (type: string, clientId: string | null) => ({ eventType: type, clientId }) as never;
  it("is a no-side-effect consumer on exactly the events that mean a person reached the customer", () => {
    expect(leadClockConsumer(async () => 0).sideEffects).toBe("none");
    expect([...leadClockConsumer(async () => 0).types!].sort()).toEqual(["call.logged", "lead.contacted", "whatsapp.message.sent"]);
  });
  it("closes the clock for the event's customer, and ignores an event with no customer", async () => {
    const close = vi.fn(async () => 1);
    const c = leadClockConsumer(close);
    await c.handle(ev("lead.contacted", "c1"), { replay: false, now: new Date() });
    await c.handle(ev("call.logged", null), { replay: false, now: new Date() });
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith("c1");
  });
});
