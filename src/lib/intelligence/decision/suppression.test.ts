import { describe, expect, it } from "vitest";
import { emptyGateContext, type GateContext } from "./gate-context";
import { evaluateSuppression } from "./suppression";
import { cand, daysAgo, daysAhead, hoursAgo, NOW } from "./test-helpers";

const ctx = (over: Partial<GateContext> = {}): GateContext => ({ ...emptyGateContext("c1", NOW), ...over });
const rules = (c: ReturnType<typeof cand>, g: GateContext) => evaluateSuppression(c, g).suppressions.map((s) => `${s.rule}:${s.effect}`);

describe("suppression rules (one table-driven case per rule)", () => {
  it("passes a clean candidate", () => {
    expect(rules(cand(), ctx())).toEqual([]);
  });

  describe("open complaint", () => {
    it("blocks a sales candidate while a complaint is open", () => {
      expect(rules(cand(), ctx({ complaint: { open: true, lastAt: daysAgo(20), because: "Open complaint about statements" } }))).toContain("open_complaint:block");
    });
    it("blocks a sales candidate for 14 days after a complaint even if resolved", () => {
      expect(rules(cand(), ctx({ complaint: { open: false, lastAt: daysAgo(10), because: "Complaint on 1 Oct" } }))).toContain("open_complaint:block");
    });
    it("does not block after the window", () => {
      expect(rules(cand(), ctx({ complaint: { open: false, lastAt: daysAgo(15), because: "old" } }))).not.toContain("open_complaint:block");
    });
    it("blocks a non-recovery onboarding step too (only service recovery is allowed)", () => {
      const onboarding = cand({ id: "stage_gate:kyc", sales: false, programme: "Complete KYC", assetClass: null, ruleKey: "stage_gate.submit_kyc" });
      expect(rules(onboarding, ctx({ complaint: { open: true, lastAt: daysAgo(1), because: "x" } }))).toContain("open_complaint:block");
    });
    it("allows service recovery", () => {
      const recovery = cand({ id: "x", sales: false, serviceRecovery: true, assetClass: null, programme: "Service / relationship follow-up", owner: "Support" });
      expect(rules(recovery, ctx({ complaint: { open: true, lastAt: daysAgo(1), because: "x" } }))).not.toContain("open_complaint:block");
    });
  });

  describe("declined class and RM-low acceptance", () => {
    it("blocks a declined class", () => {
      const r = evaluateSuppression(cand(), ctx({ declined: [{ assetClass: "PMS", because: "Customer declined PMS on 3 Oct" }] }));
      expect(r.suppressions.map((s) => s.rule)).toContain("declined_class");
      expect(r.suppressions[0].because).toContain("declined PMS on 3 Oct");
    });
    it("does not block a different class", () => {
      expect(rules(cand(), ctx({ declined: [{ assetClass: "Mutual Funds", because: "x" }] }))).toEqual([]);
    });
    it("blocks a class the RM marked Low", () => {
      expect(rules(cand(), ctx({ rmLow: [{ assetClass: "PMS", because: "RM marked PMS acceptance Low" }] }))).toContain("rm_low_acceptance:block");
    });
  });

  describe("recent contact", () => {
    it("delays a sales call within 48 hours and says until when", () => {
      const r = evaluateSuppression(cand(), ctx({ lastContactAt: hoursAgo(10) }));
      const s = r.suppressions.find((x) => x.rule === "recent_contact")!;
      expect(s.effect).toBe("delay");
      expect(s.until).toBe(new Date(hoursAgo(10).getTime() + 48 * 3600 * 1000).toISOString());
      expect(r.notBefore?.toISOString()).toBe(s.until);
      expect(r.penalties.map((p) => p.kind)).toContain("penalty");
    });
    it("does not delay after 48 hours", () => {
      expect(rules(cand(), ctx({ lastContactAt: hoursAgo(49) }))).toEqual([]);
    });
    it("does not delay service recovery", () => {
      const recovery = cand({ sales: false, serviceRecovery: true, assetClass: null, programme: "Service / relationship follow-up" });
      expect(rules(recovery, ctx({ lastContactAt: hoursAgo(1) }))).toEqual([]);
    });
  });

  describe("dismissed or snoozed", () => {
    it("blocks while the snooze runs, matched on rule and fingerprint", () => {
      const g = ctx({ dismissals: [{ ruleKey: "intelligence_nba.pms", fingerprint: "PMS", snoozeUntil: daysAhead(3), reason: null }] });
      expect(rules(cand(), g)).toContain("dismissed_or_snoozed:block");
    });
    it("lets it back after the snooze ends", () => {
      const g = ctx({ dismissals: [{ ruleKey: "intelligence_nba.pms", fingerprint: "PMS", snoozeUntil: daysAgo(1), reason: null }] });
      expect(rules(cand(), g)).toEqual([]);
    });
    it("a changed situation (different fingerprint) shows again", () => {
      const g = ctx({ dismissals: [{ ruleKey: "intelligence_nba.pms", fingerprint: "OTHER", snoozeUntil: daysAhead(3), reason: null }] });
      expect(rules(cand(), g)).toEqual([]);
    });
    it("a do-not-recommend entry for the class blocks every candidate on that class", () => {
      const g = ctx({ dismissals: [{ ruleKey: "nba.dnr", fingerprint: "dnr:PMS", snoozeUntil: daysAhead(100), reason: "Customer asked" }] });
      expect(rules(cand({ ruleKey: "something.else", fingerprint: "zzz" }), g)).toContain("dismissed_or_snoozed:block");
    });
  });

  it("unreachable twice blocks contact actions but not tasks", () => {
    const g = ctx({ unreachableAttempts: 2 });
    expect(rules(cand(), g)).toContain("unreachable:block");
    expect(rules(cand({ action: "Task", channel: "none" }), g)).toEqual([]);
    expect(rules(cand(), ctx({ unreachableAttempts: 1 }))).toEqual([]);
  });

  it("an open KYC or funding exception allows only the resolution", () => {
    const g = ctx({ kycException: { open: true, label: "KYC rejected: PAN mismatch" } });
    expect(rules(cand(), g)).toContain("kyc_exception:block");
    expect(rules(cand({ ruleKey: "stage_gate.resolve_kyc_issue", sales: false, assetClass: null }), g)).toEqual([]);
  });

  it("an AI Bot owner is replaced when the agent is disabled", () => {
    const r = evaluateSuppression(cand({ owner: "AI Bot" }), ctx({ agentEnabled: false }));
    expect(r.ownerOverride).toBe("CRM");
    expect(r.suppressions.map((s) => s.rule)).toContain("agent_disabled");
    expect(evaluateSuppression(cand({ owner: "RM" }), ctx({ agentEnabled: false })).ownerOverride).toBeUndefined();
  });

  describe("product stance", () => {
    it("a confirmed not-interested stance blocks", () => {
      const g = ctx({ productStances: [{ assetClass: "PMS", stance: "not_interested", confirmed: true, until: null, because: "RM logged: not interested in PMS" }] });
      expect(rules(cand(), g)).toContain("product_stance:block");
    });
    it("an AI-inferred stance can only downrank, never block", () => {
      const g = ctx({ productStances: [{ assetClass: "PMS", stance: "not_interested", confirmed: false, until: null, because: "AI-inferred from a call" }] });
      expect(rules(cand(), g)).toEqual(["product_stance:downrank"]);
    });
    it("an expired stance does nothing", () => {
      const g = ctx({ productStances: [{ assetClass: "PMS", stance: "not_interested", confirmed: true, until: daysAgo(1), because: "x" }] });
      expect(rules(cand(), g)).toEqual([]);
    });
  });

  it("a registry block stops a product recommendation", () => {
    expect(rules(cand(), ctx({ registryBlocks: [{ assetClass: "PMS", programme: null, reason: "PMS is not open for sale to this investor category" }] }))).toContain("product_registry:block");
  });

  describe("data staleness", () => {
    it("downranks after the soft limit", () => {
      expect(rules(cand({ asOf: daysAgo(20), freshness: { softDays: 14, hardDays: 60 } }), ctx())).toEqual(["data_stale:downrank"]);
    });
    it("blocks after the hard limit", () => {
      expect(rules(cand({ asOf: daysAgo(90), freshness: { softDays: 14, hardDays: 60 } }), ctx())).toEqual(["data_stale:block"]);
    });
    it("fresh data is fine; unknown age is treated as stale-soft", () => {
      expect(rules(cand({ asOf: daysAgo(1) }), ctx())).toEqual([]);
      expect(rules(cand({ asOf: null }), ctx())).toEqual(["data_stale:downrank"]);
    });
  });

  it("every suppression names the candidate and carries a plain reason", () => {
    const r = evaluateSuppression(cand(), ctx({ declined: [{ assetClass: "PMS", because: "Declined PMS on 3 Oct" }] }));
    expect(r.suppressions[0].candidateId).toBe("intelligence_nba:pms");
    expect(r.suppressions[0].because.length).toBeGreaterThan(5);
  });
});
