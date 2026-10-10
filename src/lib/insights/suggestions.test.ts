import { describe, expect, it } from "vitest";
import { buildSuggestions, type SuggestionInput } from "./suggestions";
import type { AgentQuality } from "./agent-quality";
import type { OutcomeMixGroup } from "./response-analytics";

function mix(key: string, total: number, positive: number, decline: number): OutcomeMixGroup {
  return {
    key, total, positiveRate: total ? positive / total : null, declineRate: total ? decline / total : null,
    counts: { INTERESTED: positive, NOT_INTERESTED: decline, FOLLOW_UP: total - positive - decline, CONVERTED: 0, NOT_RELEVANT: 0, RM_HANDOVER: 0, SERVICE_ISSUE: 0 },
  };
}
function quality(over: Partial<AgentQuality> = {}): AgentQuality {
  return {
    agentKey: "wa_nudger", generated: 50, blocked: { total: 2, regex: 1, judge: 1, rate: 0.04, byReason: { ADVICE: 1, JUDGE: 1 } }, blockedAfterEdit: 0, offered: 48,
    approved: 30, rejected: 5, expired: 13, pending: 0, sent: 30, approvalRate: 0.625, rejectionRate: 0.104, expiryRate: 0.27, edited: 6, editRate: 0.2,
    editBuckets: { none: 24, light: 3, moderate: 2, heavy: 1 }, medianApproveMinutes: 20, tokens: { input: 1, output: 1 },
    cost: { usd: 1, perApprovedUsd: 0.03, partial: false, unknownModels: [] }, byProgramme: [], ...over,
  };
}
const empty: SuggestionInput = { assetClassMix: [], programmeMix: [], agents: [], objections: [], funnel: [], aiVsRm: null };

describe("buildSuggestions", () => {
  it("says there is not enough data when nothing is available", () => {
    const s = buildSuggestions(empty);
    expect(s).toHaveLength(1);
    expect(s[0].id).toBe("not-enough-data");
  });

  it("flags an asset class declined far more often than the best, with evidence numbers", () => {
    const s = buildSuggestions({ ...empty, assetClassMix: [mix("PMS", 40, 6, 18), mix("Mutual Funds", 60, 30, 9)] });
    const hit = s.find((x) => x.id === "asset-decline-PMS")!;
    expect(hit.text).toContain("PMS");
    expect(hit.text).toContain("Mutual Funds");
    expect(hit.text).toContain("3.0x");
    expect(hit.evidence).toContain("40");
    expect(hit.evidence).toContain("60");
  });

  it("does not flag when the sample is below the minimum", () => {
    const s = buildSuggestions({ ...empty, assetClassMix: [mix("PMS", 8, 0, 8), mix("Mutual Funds", 60, 30, 9)] });
    expect(s.find((x) => x.id.startsWith("asset-decline"))).toBeUndefined();
  });

  it("does not flag when the gap is under 2x", () => {
    const s = buildSuggestions({ ...empty, assetClassMix: [mix("PMS", 40, 6, 12), mix("Mutual Funds", 60, 30, 12)] });
    expect(s.find((x) => x.id.startsWith("asset-decline"))).toBeUndefined();
  });

  it("flags a programme whose drafts are edited more than 60% of the time", () => {
    const q = quality({ byProgramme: [{ programme: "Complete KYC", approved: 20, edited: 14, editRate: 0.7 }, { programme: "Fund account", approved: 20, edited: 2, editRate: 0.1 }] });
    const s = buildSuggestions({ ...empty, agents: [q] });
    const hit = s.find((x) => x.id === "edit-wa_nudger-Complete KYC")!;
    expect(hit.text).toMatch(/edited/);
    expect(hit.text).toContain("Complete KYC");
    expect(hit.evidence).toContain("14 of 20");
    expect(s.find((x) => x.id === "edit-wa_nudger-Fund account")).toBeUndefined();
  });

  it("exactly 60% is not above the threshold; too few approvals are ignored", () => {
    const q = quality({ byProgramme: [{ programme: "A", approved: 20, edited: 12, editRate: 0.6 }, { programme: "B", approved: 4, edited: 4, editRate: 1 }] });
    expect(buildSuggestions({ ...empty, agents: [q] }).filter((x) => x.id.startsWith("edit-"))).toHaveLength(0);
  });

  it("flags a high guardrail block rate and names the top reason", () => {
    const q = quality({ generated: 40, blocked: { total: 16, regex: 12, judge: 4, rate: 0.4, byReason: { RETURN_PROMISE: 9, ADVICE: 3, JUDGE: 4 } } });
    const hit = buildSuggestions({ ...empty, agents: [q] }).find((x) => x.id === "blocked-wa_nudger")!;
    expect(hit.text).toContain("RETURN_PROMISE");
    expect(hit.evidence).toContain("16 of 40");
  });

  it("flags high expiry and high rejection", () => {
    const q = quality({ expiryRate: 0.5, expired: 24, offered: 48, rejectionRate: 0.5, rejected: 24 });
    const ids = buildSuggestions({ ...empty, agents: [q] }).map((x) => x.id);
    expect(ids).toContain("expiry-wa_nudger");
    expect(ids).toContain("rejection-wa_nudger");
  });

  it("highlights a dominant objection per asset class", () => {
    const s = buildSuggestions({ ...empty, objections: [{ assetClass: "PMS", total: 20, themes: [{ theme: "Lock-in / liquidity", count: 10, prevCount: 4, trend: "up" }, { theme: "Fees and costs", count: 4, prevCount: 4, trend: "flat" }] }] });
    const hit = s.find((x) => x.id === "objection-PMS")!;
    expect(hit.text).toContain("Lock-in / liquidity");
    expect(hit.evidence).toContain("10 of 20");
  });

  it("points at the biggest journey leak when the sample is big enough", () => {
    const s = buildSuggestions({
      ...empty,
      funnel: [
        { stageId: "1", name: "Lead", sequence: 1, reached: 100, advanced: 80, stillHere: 10, conversion: 0.8, medianHoursInStage: 24 },
        { stageId: "2", name: "KYC", sequence: 2, reached: 80, advanced: 30, stillHere: 10, conversion: 0.375, medianHoursInStage: 120 },
        { stageId: "3", name: "Funded", sequence: 3, reached: 30, advanced: 0, stillHere: 30, conversion: null, medianHoursInStage: null },
      ],
    });
    const hit = s.find((x) => x.id === "funnel-leak")!;
    expect(hit.text).toContain("KYC");
    expect(hit.evidence).toContain("30 of 80");
  });

  it("reports AI-draft vs RM-only reply comparison honestly as too early", () => {
    const s = buildSuggestions({ ...empty, assetClassMix: [mix("PMS", 40, 6, 18)], aiVsRm: { a: { successes: 5, n: 10 }, b: { successes: 2, n: 10 } } });
    const hit = s.find((x) => x.id === "ai-vs-rm")!;
    expect(hit.text.toLowerCase()).toContain("too early");
  });

  it("orders attention items before info", () => {
    const q = quality({ expiryRate: 0.5, expired: 24, offered: 48 });
    const s = buildSuggestions({ ...empty, agents: [q], aiVsRm: { a: { successes: 1, n: 5 }, b: { successes: 1, n: 5 } }, assetClassMix: [mix("PMS", 40, 6, 18), mix("Mutual Funds", 60, 30, 9)] });
    const sev = s.map((x) => x.severity);
    expect(sev.includes("info")).toBe(true);
    expect(sev.indexOf("info")).toBeGreaterThan(sev.lastIndexOf("attention"));
  });
});
