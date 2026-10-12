import { describe, expect, it } from "vitest";

import { checkCopy } from "@/lib/agents/guardrails";

import { applyDismissals, evaluateRules } from "./rules";
import type { OutcomeSubject } from "./types";

const now = new Date("2026-10-10T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const daysAhead = (n: number) => new Date(now.getTime() + n * 86_400_000);

function subject(over: Partial<OutcomeSubject> = {}): OutcomeSubject {
  return {
    clientId: "c1", name: "Test Customer", rmId: "u1", rmName: "RM One", createdAt: daysAgo(900), kycStatus: "APPROVED",
    aum: 6_000_000, holdingCount: 4, aumReference: 6_000_000,
    allocation: [{ bucket: "Equity", pct: 40 }, { bucket: "Mutual Fund", pct: 40 }, { bucket: "Fixed Income", pct: 20 }],
    idleCash: null, lastContactAt: daysAgo(10), lastTransactionAt: daysAgo(20), lastReviewAt: daysAgo(30),
    openTickets: 0, openComplaints: 0, negativeReviewRecent: false, marketingConsent: "given", goals: [], commitments: [], ...over,
  };
}
const keys = (s: OutcomeSubject) => evaluateRules(s, now).map((x) => x.ruleKey);

describe("evaluateRules", () => {
  it("is quiet for a healthy, recently reviewed customer", () => {
    expect(evaluateRules(subject(), now)).toEqual([]);
  });

  it("overdue review: shows tier, cadence, last review and days overdue", () => {
    const [s] = evaluateRules(subject({ lastReviewAt: daysAgo(250) }), now);
    expect(s.ruleKey).toBe("review_overdue");
    expect(s.why.map((w) => w.label)).toEqual(expect.arrayContaining(["Tier", "Review cadence", "Last review", "Days overdue"]));
    expect(s.why.find((w) => w.label === "Days overdue")?.value).toBe("70");
    expect(s.draft).toBe("review_overdue");
  });

  it("a customer never reviewed is judged from the day they joined, and the input says so", () => {
    const [s] = evaluateRules(subject({ lastReviewAt: null, createdAt: daysAgo(400) }), now);
    expect(s.ruleKey).toBe("review_overdue");
    expect(s.why.find((w) => w.label === "Last review")?.value).toMatch(/never/i);
  });

  it("idle cash: needs both the amount and the share, and names the source of the estimate", () => {
    expect(keys(subject({ idleCash: { amount: 50_000, source: "rm", updatedAt: daysAgo(5) } }))).not.toContain("idle_cash");
    expect(keys(subject({ idleCash: { amount: 200_000, source: "rm", updatedAt: daysAgo(5) } }))).not.toContain("idle_cash"); // 3% of 62L
    const s = evaluateRules(subject({ aum: 1_000_000, idleCash: { amount: 400_000, source: "import", updatedAt: daysAgo(5) } }), now).find((x) => x.ruleKey === "idle_cash")!;
    expect(s).toBeDefined();
    expect(s.why.map((w) => w.label)).toEqual(expect.arrayContaining(["Idle cash estimate", "Source of estimate", "Share of cash plus holdings"]));
  });

  it("concentration: one asset class at or above the threshold", () => {
    const s = evaluateRules(subject({ allocation: [{ bucket: "Equity", pct: 85 }, { bucket: "Mutual Fund", pct: 15 }] }), now).find((x) => x.ruleKey === "concentration")!;
    expect(s.why.find((w) => w.label === "Largest asset class")?.value).toContain("Equity");
    expect(keys(subject({ aum: 100_000, allocation: [{ bucket: "Equity", pct: 100 }] }))).not.toContain("concentration"); // below the minimum holdings
  });

  it("KYC gap: only for a customer who holds assets", () => {
    expect(keys(subject({ kycStatus: "ADDITIONAL_INFO_REQUIRED" }))).toContain("kyc_gap");
    expect(keys(subject({ kycStatus: null }))).toContain("kyc_gap");
    expect(keys(subject({ kycStatus: "PENDING", aum: 0, holdingCount: 0 }))).not.toContain("kyc_gap");
  });

  it("consent gap: for withdrawn, expired or missing marketing consent, never for do-not-contact, and no draft is offered", () => {
    for (const marketingConsent of ["withdrawn", "expired", "not_recorded"] as const) {
      const s = evaluateRules(subject({ marketingConsent }), now).find((x) => x.ruleKey === "consent_gap");
      expect(s, marketingConsent).toBeDefined();
    }
    expect(keys(subject({ marketingConsent: "do_not_contact" }))).not.toContain("consent_gap");
  });

  it("no draft is offered to a customer who cannot be messaged", () => {
    for (const marketingConsent of ["withdrawn", "expired", "do_not_contact"] as const) {
      const out = evaluateRules(subject({ marketingConsent, lastReviewAt: daysAgo(300) }), now);
      expect(out.every((s) => s.draft === null), marketingConsent).toBe(true);
    }
  });

  it("key dates: a goal date inside the window and a promise that is due or overdue", () => {
    const out = evaluateRules(subject({ goals: [{ id: "g1", name: "Home", targetDate: daysAhead(60), progress: "on_track" }], commitments: [{ text: "Send the statement", dueAt: daysAgo(2) }] }), now);
    const dates = out.filter((s) => s.ruleKey === "key_date");
    expect(dates.length).toBe(2);
    expect(dates.map((d) => d.fingerprint).sort()).toEqual(["commitment:Send the statement", "goal:g1"].sort());
    expect(keys(subject({ goals: [{ id: "g1", name: "Home", targetDate: daysAhead(400), progress: "on_track" }] }))).not.toContain("key_date");
  });

  it("goal behind: one suggestion per behind goal, with the goal in the inputs", () => {
    const out = evaluateRules(subject({ goals: [{ id: "g1", name: "Education", targetDate: daysAhead(900), progress: "behind" }, { id: "g2", name: "Travel", targetDate: daysAhead(900), progress: "ahead" }] }), now);
    const behind = out.filter((s) => s.ruleKey === "goal_behind");
    expect(behind).toHaveLength(1);
    expect(behind[0].why.find((w) => w.label === "Goal")?.value).toBe("Education");
  });

  it("every suggestion carries at least one input, a task and an id that is stable", () => {
    const s = subject({ lastReviewAt: daysAgo(300), kycStatus: "REJECTED", marketingConsent: "expired", goals: [{ id: "g1", name: "Home", targetDate: daysAhead(30), progress: "behind" }] });
    const out = evaluateRules(s, now);
    expect(out.length).toBeGreaterThan(3);
    for (const x of out) {
      expect(x.why.length).toBeGreaterThan(0);
      expect(x.task.title.length).toBeGreaterThan(3);
      expect(x.fingerprint.length).toBeGreaterThan(0);
    }
    expect(evaluateRules(s, now)).toEqual(out);
  });

  it("is ordered most pressing first", () => {
    const out = evaluateRules(subject({ lastReviewAt: daysAgo(400), kycStatus: "REJECTED", marketingConsent: "expired" }), now);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].rank).toBeGreaterThanOrEqual(out[i].rank);
  });

  it("its own wording passes the same language guardrails as agent and ad copy", () => {
    const out = evaluateRules(
      subject({
        lastReviewAt: daysAgo(400), kycStatus: "REJECTED", marketingConsent: "expired",
        aum: 1_000_000, idleCash: { amount: 500_000, source: "rm", updatedAt: daysAgo(3) },
        allocation: [{ bucket: "Equity", pct: 90 }, { bucket: "Fixed Income", pct: 10 }],
        goals: [{ id: "g1", name: "Home", targetDate: daysAhead(30), progress: "behind" }], commitments: [{ text: "Call back", dueAt: daysAgo(1) }],
      }),
      now,
    );
    expect(out.length).toBeGreaterThan(5);
    for (const s of out) {
      for (const text of [s.title, s.detail, s.task.title, ...s.why.map((w) => `${w.label} ${w.value}`)]) expect(checkCopy(text, 600), text).toEqual({ ok: true });
    }
  });
});

describe("applyDismissals", () => {
  it("hides exactly the dismissed situation and nothing else", () => {
    const s = subject({ lastReviewAt: daysAgo(300), kycStatus: "REJECTED" });
    const all = evaluateRules(s, now);
    const kept = applyDismissals(all, [{ ruleKey: "review_overdue", fingerprint: all.find((x) => x.ruleKey === "review_overdue")!.fingerprint }]);
    expect(kept.map((x) => x.ruleKey)).toEqual(all.map((x) => x.ruleKey).filter((k) => k !== "review_overdue"));
  });
  it("lets it come back when the situation changes (a different fingerprint)", () => {
    const s = subject({ aum: 1_000_000, idleCash: { amount: 400_000, source: "rm", updatedAt: daysAgo(3) } });
    const first = evaluateRules(s, now).find((x) => x.ruleKey === "idle_cash")!;
    const changed = evaluateRules({ ...s, idleCash: { amount: 900_000, source: "rm", updatedAt: daysAgo(1) } }, now).find((x) => x.ruleKey === "idle_cash")!;
    expect(applyDismissals([changed], [{ ruleKey: "idle_cash", fingerprint: first.fingerprint }])).toHaveLength(1);
  });
});
