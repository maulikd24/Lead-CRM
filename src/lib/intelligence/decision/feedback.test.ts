import { describe, expect, it } from "vitest";
import { planFeedback, type DecisionSnapshot } from "./feedback";
import { NOW } from "./test-helpers";

const dec = (over: Partial<DecisionSnapshot> = {}): DecisionSnapshot => ({ id: "d1", result: "RECOMMEND", action: "Call", programme: "PMS / AIF opportunity", topic: "PMS", assetClass: "PMS", timing: "This Week", chosenRuleKey: "intelligence_nba.pms", chosenFingerprint: "PMS", status: "OPEN", ...over });
const day = 86_400_000;

describe("decision feedback planner", () => {
  it("accept creates a task for the assigned RM and never anything outbound", () => {
    const p = planFeedback(dec(), { kind: "accept" }, NOW, "rm1");
    expect(p).toMatchObject({ ok: true, status: "ACCEPTED", task: { assignedToId: "rm1", source: "nba:d1", title: "PMS" } });
    if (p.ok) {
      expect(p.task!.dueAt.getTime()).toBeGreaterThan(NOW.getTime());
      expect(Object.keys(p)).not.toContain("message");
    }
  });
  it("accept needs someone to own the task", () => {
    expect(planFeedback(dec(), { kind: "accept" }, NOW, null)).toMatchObject({ ok: false });
  });
  it("done only marks the decision done", () => {
    expect(planFeedback(dec(), { kind: "done" }, NOW, "rm1")).toMatchObject({ ok: true, status: "DONE", task: null, dismissal: null });
  });
  it("snooze 1, 3 or 7 days writes a dismissal on the chosen rule and fingerprint", () => {
    for (const days of [1, 3, 7]) {
      const p = planFeedback(dec(), { kind: "snooze", days }, NOW, "rm1");
      expect(p).toMatchObject({ ok: true, status: "SNOOZED", dismissal: { ruleKey: "intelligence_nba.pms", fingerprint: "PMS" } });
      if (p.ok) expect(p.dismissal!.snoozeUntil.getTime()).toBe(NOW.getTime() + days * day);
    }
    expect(planFeedback(dec(), { kind: "snooze", days: 2 }, NOW, "rm1")).toMatchObject({ ok: false });
  });
  it("not now needs a future date within 90 days", () => {
    expect(planFeedback(dec(), { kind: "not_now", until: new Date(NOW.getTime() + 10 * day) }, NOW, "rm1")).toMatchObject({ ok: true, status: "SNOOZED" });
    expect(planFeedback(dec(), { kind: "not_now", until: new Date(NOW.getTime() - day) }, NOW, "rm1")).toMatchObject({ ok: false });
    expect(planFeedback(dec(), { kind: "not_now", until: new Date(NOW.getTime() + 120 * day) }, NOW, "rm1")).toMatchObject({ ok: false });
    expect(planFeedback(dec(), { kind: "not_now", until: new Date("nope") }, NOW, "rm1")).toMatchObject({ ok: false });
  });
  it("wrong needs one of the listed reasons and snoozes the same item for a week", () => {
    expect(planFeedback(dec(), { kind: "wrong", reason: "free text" }, NOW, "rm1")).toMatchObject({ ok: false });
    const p = planFeedback(dec(), { kind: "wrong", reason: "wrong_product" }, NOW, "rm1");
    expect(p).toMatchObject({ ok: true, status: "DISMISSED", feedback: { reason: "wrong_product" } });
    if (p.ok) expect(p.dismissal!.snoozeUntil.getTime()).toBe(NOW.getTime() + 7 * day);
  });
  it("a no-action or abstain decision can only be marked wrong", () => {
    expect(planFeedback(dec({ result: "NO_ACTION", action: "No Action" }), { kind: "accept" }, NOW, "rm1")).toMatchObject({ ok: false });
    expect(planFeedback(dec({ result: "ABSTAIN", action: "No Action" }), { kind: "snooze", days: 1 }, NOW, "rm1")).toMatchObject({ ok: false });
    expect(planFeedback(dec({ result: "ABSTAIN", action: "No Action" }), { kind: "wrong", reason: "wrong_fact" }, NOW, "rm1")).toMatchObject({ ok: true, dismissal: null });
  });
  describe("do not recommend", () => {
    it("writes a scoped suppression with an expiry (default 180 days) and a reason", () => {
      const p = planFeedback(dec(), { kind: "dnr", reason: "customer_asked" }, NOW, "rm1");
      expect(p).toMatchObject({ ok: true, status: "DISMISSED", dismissal: { ruleKey: "nba.dnr", fingerprint: "dnr:PMS", reason: "customer_asked" }, suppression: { scope: "PMS", assetClass: "PMS" } });
      if (p.ok) expect(p.dismissal!.snoozeUntil.getTime()).toBe(NOW.getTime() + 180 * day);
    });
    it("needs a listed reason and an expiry inside two years", () => {
      expect(planFeedback(dec(), { kind: "dnr", reason: "because" }, NOW, "rm1")).toMatchObject({ ok: false });
      expect(planFeedback(dec(), { kind: "dnr", reason: "other", until: new Date(NOW.getTime() + 800 * day) }, NOW, "rm1")).toMatchObject({ ok: false });
      expect(planFeedback(dec(), { kind: "dnr", reason: "other", until: new Date(NOW.getTime() + 30 * day) }, NOW, "rm1")).toMatchObject({ ok: true });
    });
    it("applies to a product or topic, not to a service step", () => {
      expect(planFeedback(dec({ programme: "Service / relationship follow-up", assetClass: null }), { kind: "dnr", reason: "other" }, NOW, "rm1")).toMatchObject({ ok: false });
      expect(planFeedback(dec({ programme: "Portfolio rebalance", assetClass: null }), { kind: "dnr", reason: "other" }, NOW, "rm1")).toMatchObject({ ok: true, suppression: { scope: "Portfolio rebalance" } });
    });
  });
});
