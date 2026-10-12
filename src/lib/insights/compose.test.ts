import { describe, expect, it } from "vitest";
import { composeInsights, type RawInsights } from "./compose";

const NOW = new Date("2026-10-09T12:00:00Z");
const D = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * D);

function raw(over: Partial<RawInsights> = {}): RawInsights {
  return {
    now: NOW, days: 30, outcomes: [], sentDrafts: [], conversionOutcomes: [], conversionDrafts: [], proposals: [], outbound: [], inbound: [], milestones: new Map(), objectionsCurrent: [], objectionsPrevious: [],
    stages: [], journeyClients: [], history: [], drilldown: [], truncated: false, ...over,
  };
}

describe("composeInsights", () => {
  it("handles a completely empty period", () => {
    const d = composeInsights(raw());
    expect(d.kpis.outcomes).toBe(0);
    expect(d.kpis.positiveRate).toBeNull();
    expect(d.kpis.replyRate).toBeNull();
    expect(d.kpis.costAvailable).toBe(false);
    expect(d.suggestions[0].id).toBe("not-enough-data");
    expect(d.mix.assetClass).toEqual([]);
  });

  it("ties outcomes, drafts, replies and conversions together without exposing identities", () => {
    const d = composeInsights(
      raw({
        outcomes: [
          { clientId: "c1", outcome: "INTERESTED", channel: "WHATSAPP", actorType: "RM", rmId: "u1", rmName: "RM One", assetClass: "PMS", programme: "PMS / AIF opportunity", language: "English", createdAt: ago(20), aiDraftSent: false },
          { clientId: "c2", outcome: "NOT_INTERESTED", channel: "CALL", actorType: "RM", rmId: "u1", rmName: "RM One", assetClass: "PMS", programme: "PMS / AIF opportunity", language: "Hindi", createdAt: ago(20), aiDraftSent: false },
        ],
        sentDrafts: [{ clientId: "c1", sentAt: ago(22) }],
        conversionOutcomes: [{ clientId: "c1", outcome: "INTERESTED", at: ago(20) }],
        conversionDrafts: [{ clientId: "c1", sentAt: ago(22) }],
        outbound: [{ id: "m1", clientId: "c1", sentAt: ago(22), language: "English", viaAgent: true }],
        inbound: [{ clientId: "c1", at: new Date(ago(22).getTime() + 3_600_000) }],
        milestones: new Map([["c1", { kycAt: ago(18), fundedAt: null }]]),
        drilldown: [{ clientId: "c2", firstName: "Asha", clientCode: "CL-00002", outcome: "NOT_INTERESTED", assetClass: "PMS", at: ago(20) }],
      }),
    );
    expect(d.kpis.outcomes).toBe(2);
    expect(d.kpis.positiveRate).toBe(0.5);
    expect(d.kpis.replyRate).toBe(1);
    expect(d.mix.channel.map((g) => g.key).sort()).toEqual(["Call", "RM after AI draft"]);
    expect(d.conversion.afterDraft).toMatchObject({ n: 1, kyc: 1, kycRate: 1 });
    expect(d.aiVsRm?.a).toEqual({ successes: 1, n: 1 });
    expect(d.drilldown[0]).toMatchObject({ firstName: "Asha", clientCode: "CL-00002", outcomeLabel: "Not interested" });
    const { drilldown: _drill, ...aggregates } = d; // drill-down rows carry the id only so they can link to a record the viewer may open
    void _drill;
    const json = JSON.stringify(aggregates);
    expect(json).not.toContain("c1");
    expect(json).not.toContain("c2");
  });

  it("builds the conversion table from its own matured cohort, so a 7-day view is not empty", () => {
    const d = composeInsights(
      raw({
        days: 7,
        outcomes: [{ clientId: "c9", outcome: "INTERESTED", channel: "CALL", actorType: "RM", rmId: "u1", rmName: "RM One", assetClass: null, programme: null, language: null, createdAt: ago(2), aiDraftSent: false }],
        conversionOutcomes: [{ clientId: "c1", outcome: "INTERESTED", at: ago(20) }],
        milestones: new Map([["c1", { kycAt: ago(18), fundedAt: null }]]),
      }),
    );
    expect(d.conversion.byOutcome).toHaveLength(1);
    expect(d.conversion.byOutcome[0]).toMatchObject({ key: "Interested", n: 1, kyc: 1 });
  });

  it("flags the cost as partial when rows were capped or a model is unpriced", () => {
    expect(composeInsights(raw({ truncated: true })).kpis.costPartial).toBe(true);
    expect(composeInsights(raw()).kpis.costPartial).toBe(false);
    const priced = composeInsights(raw({ proposals: [{ agentKey: "wa_nudger", status: "SENT", blockedReason: null, model: "mystery-model", inputTokens: 10, outputTokens: 10, body: "a", originalBody: "a", programme: null, createdAt: ago(1), decidedAt: ago(1), decidedById: "u", expiresAt: ago(-1), messageId: "m" }] }));
    expect(priced.kpis.costPartial).toBe(true);
  });
});
