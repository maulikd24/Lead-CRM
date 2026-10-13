import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  getFunnelTotals: vi.fn(async () => ({ leads: 100, kyc: 60, funded: 30, activated: 10 })),
  getTeamFollowups: vi.fn(async () => ({ rms: [], unassigned: 0 })),
  getTopObjections: vi.fn(async () => []),
  listCustomers: vi.fn(async () => ({ total: 0, rows: [] })),
  listHniPmsHighAcceptance: vi.fn(async () => ({ total: 0, rows: [] })),
  listKycNotFunded: vi.fn(async (_scope: unknown, _limit?: number) => ({ total: 0, rows: [] as Array<{ id: string; name: string; code: string; rm: string | null }> })),
}));
vi.mock("./management", () => reads);

import { INTENTS, answerQuestion, matchIntent, normaliseQuestion, SUPPORTED_QUESTIONS, INTENT_BY_ID } from "./ask-intents";

const scope = {} as never;
const NOW = new Date("2026-10-13T09:30:00Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("matchIntent: the six questions, and their paraphrases", () => {
  const cases: Array<[string, string]> = [
    ["Which customers need attention today?", "attention_today"],
    ["show me the customers that need attention", "attention_today"],
    ["Which HNI clients have high PMS acceptance?", "hni_pms_high_acceptance"],
    ["HNI customers with PMS acceptance", "hni_pms_high_acceptance"],
    ["Which KYC customers have not funded?", "kyc_not_funded"],
    ["KYC approved but unfunded customers", "kyc_not_funded"],
    ["Which RMs have overdue follow-ups?", "rm_overdue_followups"],
    ["which team members are overdue on follow up", "rm_overdue_followups"],
    ["What are the most common customer objections?", "common_objections"],
    ["what objection comes up most", "common_objections"],
    ["Where are we losing customers in the journey?", "journey_loss"],
    ["where do we lose people in the funnel", "journey_loss"],
  ];
  it.each(cases)("%s -> %s", (question, id) => {
    expect(matchIntent(question)).toBe(id);
  });

  it("returns null for anything that is not one of the six, rather than guessing", () => {
    expect(matchIntent("What is our total AUM this quarter?")).toBeNull();
    expect(matchIntent("Which RMs closed the most trades?")).toBeNull();
    expect(matchIntent("Show lost opportunities")).toBeNull();
    expect(matchIntent("hi")).toBeNull();
    expect(matchIntent("")).toBeNull();
  });

  it("ignores case and punctuation", () => {
    expect(normaliseQuestion("  Which  KYC customers, have NOT funded?? ")).toBe("which kyc customers have not funded");
    expect(matchIntent("WHICH KYC CUSTOMERS HAVE NOT FUNDED!!!")).toBe("kyc_not_funded");
  });

  it("the table has exactly the six intents, each with a question the page can offer", () => {
    expect(INTENTS.map((i) => i.id).sort()).toEqual(["attention_today", "common_objections", "hni_pms_high_acceptance", "journey_loss", "kyc_not_funded", "rm_overdue_followups"]);
    expect(SUPPORTED_QUESTIONS).toHaveLength(6);
    for (const q of SUPPORTED_QUESTIONS) expect(matchIntent(q)).not.toBeNull();
  });
});

describe("answerQuestion", () => {
  it("an unsupported question says so, lists the six, and runs no query", async () => {
    const r = await answerQuestion("What is our AUM?", scope, NOW);
    expect(r).toMatchObject({ ok: false, reason: "unsupported", supported: SUPPORTED_QUESTIONS });
    for (const fn of Object.values(reads)) expect(fn).not.toHaveBeenCalled();
  });

  it("a matched question runs its own query with the scope and reports its source and as-of time", async () => {
    reads.listKycNotFunded.mockResolvedValueOnce({ total: 1, rows: [{ id: "c1", name: "Asha", code: "CL-00001", rm: "Ravi" }] });
    const r = await answerQuestion("Which KYC customers have not funded?", scope, NOW);
    expect(reads.listKycNotFunded).toHaveBeenCalledWith(scope, 10);
    expect(r).toMatchObject({ ok: true, intent: "kyc_not_funded", answer: "1 KYC-approved customer has not funded yet.", asOf: NOW.toISOString() });
    if (r.ok) {
      expect(r.source).toMatch(/KycRecord/);
      expect(r.rows).toEqual([{ label: "Asha (CL-00001)", detail: "RM: Ravi" }]);
    }
  });
});

describe("intent builders", () => {
  it("attention today: says so when nothing is due, and lists the top rows with programme, action and RM", () => {
    const none = INTENT_BY_ID.attention_today.build({ total: 0, rows: [] }) as { answer: string };
    expect(none.answer).toBe("No customer has a next action due today.");
    const some = INTENT_BY_ID.attention_today.build({
      total: 12,
      rows: [{ id: "a", name: "Meera", code: "CL-2", rm: null, lifecycle: "KYC", programme: "Complete KYC", action: "Call", topic: null, priority: "High", timing: "Today", reason: "" }],
    }) as { answer: string; rows: Array<{ label: string; detail: string }> };
    expect(some.answer).toBe("12 customers have a next action due today. The top 1 by priority are listed.");
    expect(some.rows[0]).toEqual({ label: "Meera (CL-2)", detail: "Complete KYC · Call · RM: unassigned" });
  });

  it("HNI PMS: counts the customers with high PMS acceptance", () => {
    expect((INTENT_BY_ID.hni_pms_high_acceptance.build({ total: 0, rows: [] }) as { answer: string }).answer).toMatch(/No HNI customer/);
    expect((INTENT_BY_ID.hni_pms_high_acceptance.build({ total: 3, rows: [] }) as { answer: string }).answer).toBe("3 HNI customers are marked High for PMS acceptance.");
  });

  it("RM overdue: keeps only RMs with overdue tasks, and totals them", () => {
    const out = INTENT_BY_ID.rm_overdue_followups.build({
      rms: [
        { rm: "Ravi", open: 5, overdue: 2 },
        { rm: "Anil", open: 3, overdue: 0 },
        { rm: "Priya", open: 4, overdue: 3 },
      ],
      unassigned: 0,
    }) as { answer: string; rows: Array<{ label: string; detail: string }> };
    expect(out.answer).toBe("2 RMs have overdue follow-ups, 5 in total.");
    expect(out.rows.map((r) => r.label)).toEqual(["Ravi", "Priya"]);
    expect(out.rows[0].detail).toBe("2 overdue · 5 open");
  });

  it("RM overdue: says so when nobody is late", () => {
    expect((INTENT_BY_ID.rm_overdue_followups.build({ rms: [{ rm: "Anil", open: 1, overdue: 0 }], unassigned: 0 }) as { answer: string }).answer).toBe("No RM has overdue follow-ups right now.");
  });

  it("objections: groups identical wording after trimming and case, and ranks by count", () => {
    const out = INTENT_BY_ID.common_objections.build([
      { text: "Fees are too high", assetClass: "PMS" },
      { text: "  fees are   too high ", assetClass: "PMS" },
      { text: "Lock-in period is long", assetClass: "AIF" },
      { text: "Fees are too high", assetClass: null },
    ]) as { answer: string; rows: Array<{ label: string; detail: string }> };
    expect(out.rows[0]).toEqual({ label: "Fees are too high", detail: "3 times · mostly PMS" });
    expect(out.rows[1]).toEqual({ label: "Lock-in period is long", detail: "1 time · mostly AIF" });
    expect(out.answer).toMatch(/Of 4 objections/);
  });

  it("objections: says so when none were recorded", () => {
    expect((INTENT_BY_ID.common_objections.build([]) as { answer: string }).answer).toBe("No objections were recorded in the last 90 days.");
  });

  it("journey loss: names the weakest step between stages, as a share of the stage before", () => {
    const out = INTENT_BY_ID.journey_loss.build({ leads: 100, kyc: 60, funded: 30, activated: 10 }) as { answer: string; rows: Array<{ label: string; detail: string }> };
    expect(out.answer).toBe("The biggest loss is from Funded to Activated: 33.3% move on (10 of 30).");
    expect(out.rows).toHaveLength(4);
    expect(out.rows[2].detail).toBe("30 · 50% of the previous stage");
  });

  it("journey loss: no leads means no loss to report", () => {
    expect((INTENT_BY_ID.journey_loss.build({ leads: 0, kyc: 0, funded: 0, activated: 0 }) as { answer: string }).answer).toBe("There are no leads or signups in scope yet.");
  });
});
