import { describe, expect, it } from "vitest";

import { checkCopy } from "@/lib/agents/guardrails";

import { OUTCOME_CONFIG } from "./config";
import { computeAttentionScore } from "./risk";
import type { OutcomeSubject } from "./types";

const now = new Date("2026-10-10T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

function subject(over: Partial<OutcomeSubject> = {}): OutcomeSubject {
  return {
    clientId: "c1", name: "T", rmId: "u1", rmName: "RM", createdAt: daysAgo(900), kycStatus: "APPROVED",
    aum: 6_000_000, holdingCount: 4, aumReference: 6_000_000, allocation: [{ bucket: "Equity", pct: 50 }, { bucket: "Mutual Fund", pct: 50 }],
    idleCash: null, lastContactAt: daysAgo(5), lastTransactionAt: daysAgo(10), lastReviewAt: daysAgo(20),
    openTickets: 0, openComplaints: 0, negativeReviewRecent: false, marketingConsent: "given", goals: [], commitments: [], ...over,
  };
}

describe("weights", () => {
  it("add up to exactly 100", () => {
    expect(Object.values(OUTCOME_CONFIG.risk.weights).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("computeAttentionScore", () => {
  it("is zero and Low for a customer with nothing flagged", () => {
    const r = computeAttentionScore(subject(), now);
    expect(r.score).toBe(0);
    expect(r.band).toBe("low");
  });

  it("lists every input, flagged or not, with its weight, its inputs in words and the points it added", () => {
    const r = computeAttentionScore(subject(), now);
    expect(r.factors.map((f) => f.key)).toEqual(["contactGap", "reviewOverdue", "serviceSignals", "dormancy", "valueFall", "goalsBehind", "consentWithdrawn", "kycGap"]);
    for (const f of r.factors) {
      expect(f.weight).toBeGreaterThan(0);
      expect(f.input.length).toBeGreaterThan(0);
      expect(f.points).toBe(Math.round(f.weight * f.share * 10) / 10);
    }
    expect(r.factors.reduce((a, f) => a + f.weight, 0)).toBe(100);
  });

  it("the total is the sum of the points of the factors (no hidden term)", () => {
    const r = computeAttentionScore(subject({ lastContactAt: daysAgo(90), openTickets: 2, kycStatus: "REJECTED", lastReviewAt: daysAgo(400) }), now);
    expect(r.score).toBe(Math.round(r.factors.reduce((a, f) => a + f.points, 0)));
  });

  it("contact gap ramps linearly between the configured days", () => {
    const f = (days: number) => computeAttentionScore(subject({ lastContactAt: daysAgo(days) }), now).factors.find((x) => x.key === "contactGap")!;
    expect(f(30).share).toBe(0);
    expect(f(75).share).toBeCloseTo(0.5, 2);
    expect(f(120).share).toBe(1);
    expect(f(400).share).toBe(1);
  });

  it("never contacted counts from the day the customer joined", () => {
    const f = computeAttentionScore(subject({ lastContactAt: null, createdAt: daysAgo(200) }), now).factors.find((x) => x.key === "contactGap")!;
    expect(f.share).toBe(1);
    expect(f.input).toMatch(/no contact recorded/i);
  });

  it("an unknown input scores nothing and says it is unknown (missing data is not treated as risk)", () => {
    const r = computeAttentionScore(subject({ lastTransactionAt: null, aumReference: null }), now);
    const dormancy = r.factors.find((x) => x.key === "dormancy")!;
    const fall = r.factors.find((x) => x.key === "valueFall")!;
    expect(dormancy.share).toBe(0);
    expect(fall.share).toBe(0);
    expect(fall.input).toMatch(/no earlier snapshot/i);
  });

  it("a fall in holdings value over the window scales between the configured percentages", () => {
    const f = computeAttentionScore(subject({ aum: 4_500_000, aumReference: 6_000_000 }), now).factors.find((x) => x.key === "valueFall")!; // -25%
    expect(f.share).toBeCloseTo((25 - 5) / (30 - 5), 2);
    expect(f.input).toMatch(/includes market moves/i);
  });

  it("goals behind is the share of goals that are behind", () => {
    const goals = [
      { id: "a", name: "A", targetDate: now, progress: "behind" as const },
      { id: "b", name: "B", targetDate: now, progress: "on_track" as const },
    ];
    expect(computeAttentionScore(subject({ goals }), now).factors.find((x) => x.key === "goalsBehind")!.share).toBe(0.5);
  });

  it("service signals combine open tickets, open complaints and a recent negative review, capped at 1", () => {
    const f = (over: Partial<OutcomeSubject>) => computeAttentionScore(subject(over), now).factors.find((x) => x.key === "serviceSignals")!;
    expect(f({ openTickets: 1 }).share).toBeCloseTo(0.4, 2);
    expect(f({ openComplaints: 1 }).share).toBeCloseTo(0.6, 2);
    expect(f({ negativeReviewRecent: true }).share).toBeCloseTo(0.4, 2);
    expect(f({ openTickets: 3, openComplaints: 2, negativeReviewRecent: true }).share).toBe(1);
  });

  it("bands follow the configured cut-offs", () => {
    const high = computeAttentionScore(subject({ lastContactAt: daysAgo(200), lastReviewAt: daysAgo(500), openTickets: 3, kycStatus: "REJECTED", lastTransactionAt: daysAgo(400), aum: 3_000_000, aumReference: 6_000_000 }), now);
    expect(high.band).toBe("high");
    expect(high.score).toBeGreaterThanOrEqual(OUTCOME_CONFIG.risk.bands.high);
    const medium = computeAttentionScore(subject({ lastContactAt: daysAgo(120), lastReviewAt: daysAgo(300) }), now);
    expect(medium.band).toBe("medium");
  });

  it("only counts what is known about the customer, and never uses personal attributes", () => {
    const r = computeAttentionScore(subject(), now);
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/age|gender|religion|caste|city|income|mobile|email/i);
  });

  it("its wording passes the same language guardrails", () => {
    const r = computeAttentionScore(subject({ lastContactAt: daysAgo(90), openTickets: 1, aum: 4_000_000, aumReference: 6_000_000 }), now);
    for (const f of r.factors) expect(checkCopy(`${f.label} ${f.input}`, 600), f.label).toEqual({ ok: true });
  });
});
