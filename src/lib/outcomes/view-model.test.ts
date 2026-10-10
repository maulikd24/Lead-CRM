import { describe, expect, it } from "vitest";

import { checkCopy } from "@/lib/agents/guardrails";

import { buildGoalView } from "./goals";
import { computeAttentionScore } from "./risk";
import { evaluateRules } from "./rules";
import { reviewStatus } from "./cadence";
import type { OutcomeBundle } from "./loaders";
import type { OutcomeSubject } from "./types";
import { toOutcomesViewModel } from "./view-model";

const now = new Date("2026-10-10T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

function bundle(): OutcomeBundle {
  const holdings = [
    { accountId: "a1", productId: "p1", name: "Fund One", category: "MUTUAL_FUND", value: 400_000, accountLabel: "account ending 1234" },
    { accountId: "a1", productId: "p2", name: "Stock Two", category: "EQUITY", value: 100_000, accountLabel: "account ending 1234" },
  ];
  const goalRecord = { id: "g1", name: "Education", targetAmount: 2_000_000, targetDate: new Date("2032-06-01T00:00:00Z"), priority: "HIGH", status: "ACTIVE", annualRatePct: 9, plannedMonthly: 10_000, notes: "Two children", linkedAccountIds: [], linkedHoldingKeys: ["a1:p1"] };
  const goals = [buildGoalView(goalRecord, holdings, now)];
  const subject: OutcomeSubject = {
    clientId: "c1", name: "Test", rmId: "u1", rmName: "RM", createdAt: daysAgo(900), kycStatus: "REJECTED", aum: 500_000, holdingCount: 2, aumReference: 650_000,
    allocation: [{ bucket: "Mutual Fund", pct: 80 }, { bucket: "Equity", pct: 20 }], idleCash: null, lastContactAt: daysAgo(100), lastTransactionAt: daysAgo(30), lastReviewAt: daysAgo(400),
    openTickets: 1, openComplaints: 0, negativeReviewRecent: false, marketingConsent: "given", goals: [{ id: "g1", name: "Education", targetDate: goalRecord.targetDate, progress: goals[0].progress.status }], commitments: [],
  };
  return { subject, holdings, goals, review: reviewStatus({ aum: 500_000, lastReviewAt: subject.lastReviewAt, createdAt: subject.createdAt, now }), score: computeAttentionScore(subject, now), suggestions: evaluateRules(subject, now) };
}

describe("toOutcomesViewModel", () => {
  const vm = toOutcomesViewModel(bundle(), { canEdit: true, draftsOn: true, disclaimer: "Illustrative only. Assumed rates. Not a forecast. Market risk." });

  it("is plain data: it survives a JSON round trip unchanged (it crosses from server to client components)", () => {
    expect(JSON.parse(JSON.stringify(vm))).toEqual(vm);
  });

  it("carries the disclaimer and the assumptions with every goal", () => {
    expect(vm.disclaimer).toMatch(/illustrative/i);
    const g = vm.goals[0];
    expect(g.assumptionsLine).toMatch(/9\.0% per year/);
    expect(g.sentence).toMatch(/illustratively/);
    expect(g.rate).toBe(9);
    expect(g.plannedMonthly).toBe(10_000);
    expect(g.statusLabel).toMatch(/at the assumed rate/);
  });

  it("lists the linked holdings and offers the customer's holdings for linking, by account and holding", () => {
    expect(vm.goals[0].linked).toEqual([{ label: "Fund One", detail: "account ending 1234", valueText: "₹4,00,000" }]);
    expect(vm.holdingOptions.map((h) => h.key)).toEqual(["a1:p1", "a1:p2"]);
    expect(vm.accountOptions).toEqual([{ id: "a1", label: "account ending 1234" }]);
  });

  it("keeps the raw values the edit form needs (ids, amounts, date as yyyy-mm-dd)", () => {
    expect(vm.goals[0].form).toMatchObject({ name: "Education", targetAmount: 2_000_000, targetDate: "2032-06-01", priority: "HIGH", linkedHoldingKeys: ["a1:p1"], linkedAccountIds: [] });
  });

  it("the score carries every factor and the first few as a short 'why' for the tooltip", () => {
    expect(vm.score.factors).toHaveLength(8);
    expect(vm.score.topReasons.length).toBeLessThanOrEqual(3);
    expect(vm.score.topReasons.every((t) => typeof t === "string" && t.length > 0)).toBe(true);
    expect(vm.score.bandLabel).toMatch(/attention/i);
  });

  it("offers actions only to someone who may edit, and a draft only when drafts are on and the rule has one", () => {
    expect(vm.suggestions.every((s) => s.canAct)).toBe(true);
    const readOnly = toOutcomesViewModel(bundle(), { canEdit: false, draftsOn: true, disclaimer: "d" });
    expect(readOnly.canEdit).toBe(false);
    expect(readOnly.suggestions.every((s) => !s.canAct && !s.canDraft)).toBe(true);
    const noDrafts = toOutcomesViewModel(bundle(), { canEdit: true, draftsOn: false, disclaimer: "d" });
    expect(noDrafts.suggestions.every((s) => !s.canDraft)).toBe(true);
    expect(vm.suggestions.some((s) => s.canDraft)).toBe(true);
  });

  it("every piece of text it produces passes the language guardrails", () => {
    const texts: string[] = [vm.score.bandLabel, ...vm.score.topReasons, ...vm.score.factors.map((f) => `${f.label} ${f.input}`), vm.review.summary];
    for (const g of vm.goals) texts.push(g.statusLabel, g.sentence, g.assumptionsLine);
    for (const s of vm.suggestions) texts.push(s.title, s.detail, ...s.why.map((w) => `${w.label} ${w.value}`));
    for (const t of texts) expect(checkCopy(t, 800), t).toEqual({ ok: true });
  });
});
