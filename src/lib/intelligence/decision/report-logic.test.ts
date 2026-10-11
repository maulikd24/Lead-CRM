import { describe, expect, it } from "vitest";
import { oracleAllows, type OraclePolicy } from "./consent-oracle";
import { evaluateExitCriteria, type ShadowStats } from "./exit-criteria";
import { CORRELATION_NOTE, linkOutcomes, outcomeRates } from "./outcome-linking";

const POLICY: OraclePolicy = { MARKETING_COMMS: "required", SERVICE_COMMS: "default_allow" };
const at = new Date("2026-10-11T10:00:00Z");
const d = (n: number) => new Date(at.getTime() - n * 86400000);

describe("consent oracle (independent implementation)", () => {
  it("needs a grant for marketing; default allows service", () => {
    expect(oracleAllows([], null, "MARKETING_COMMS", "call", at, POLICY)).toBe(false);
    expect(oracleAllows([], null, "SERVICE_COMMS", "call", at, POLICY)).toBe(true);
  });
  it("a legacy lead-form timestamp counts as a marketing grant", () => {
    expect(oracleAllows([], d(10), "MARKETING_COMMS", "whatsapp", at, POLICY)).toBe(true);
  });
  it("newest row wins, a withdrawal blocks, a channel row applies only to its channel", () => {
    const rows = [{ purpose: "MARKETING_COMMS", channel: null, status: "GRANTED", capturedAt: d(30) }, { purpose: "MARKETING_COMMS", channel: "whatsapp", status: "WITHDRAWN", capturedAt: d(2) }];
    expect(oracleAllows(rows, null, "MARKETING_COMMS", "whatsapp", at, POLICY)).toBe(false);
    expect(oracleAllows(rows, null, "MARKETING_COMMS", "call", at, POLICY)).toBe(true);
  });
  it("do not contact stops everything, and a later withdrawal of the flag lifts it", () => {
    const on = [{ purpose: "DO_NOT_CONTACT", channel: null, status: "GRANTED", capturedAt: d(5) }];
    expect(oracleAllows(on, d(40), "SERVICE_COMMS", "call", at, POLICY)).toBe(false);
    expect(oracleAllows([...on, { purpose: "DO_NOT_CONTACT", channel: null, status: "WITHDRAWN", capturedAt: d(1) }], d(40), "SERVICE_COMMS", "call", at, POLICY)).toBe(true);
  });
  it("rows dated after the decision are not in effect then", () => {
    expect(oracleAllows([{ purpose: "MARKETING_COMMS", channel: null, status: "GRANTED", capturedAt: new Date(at.getTime() + 1000) }], null, "MARKETING_COMMS", "call", at, POLICY)).toBe(false);
  });
  it("an expired grant on a required purpose is not a grant", () => {
    expect(oracleAllows([{ purpose: "MARKETING_COMMS", channel: null, status: "GRANTED", capturedAt: d(60), expiresAt: d(1) }], null, "MARKETING_COMMS", "call", at, POLICY)).toBe(false);
  });
});

const stats = (over: Partial<ShadowStats> = {}): ShadowStats => ({
  decisions: 200,
  materialRegressions: 0,
  daily: [8, 9, 10, 9, 8, 9].map((n, i) => ({ date: `2026-10-0${i + 1}`, decisions: 100, disagreements: n })),
  consent: { checked: 150, mismatches: 0 },
  productReview: { reviewedProductDecisions: 30, seriousFalsePositives: 0 },
  gates: { tests: "pass", evals: "pass" },
  ...over,
});
const status = (s: ShadowStats, id: string) => evaluateExitCriteria(s).criteria.find((c) => c.id === id)!.status;

describe("shadow exit criteria", () => {
  it("all pass when every threshold is met", () => {
    const r = evaluateExitCriteria(stats());
    expect(r.ready).toBe(true);
    expect(r.criteria.map((c) => c.status)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
  });
  it("one material regression fails the suppression criterion and blocks readiness", () => {
    expect(status(stats({ materialRegressions: 1 }), "no_material_suppression_regressions")).toBe("fail");
    expect(evaluateExitCriteria(stats({ materialRegressions: 1 })).ready).toBe(false);
  });
  it("a single consent mismatch fails (100% is exact)", () => {
    expect(status(stats({ consent: { checked: 150, mismatches: 1 } }), "consent_policy_agreement")).toBe("fail");
  });
  it("too few reviewed product decisions is insufficient data, never pass", () => {
    expect(status(stats({ productReview: { reviewedProductDecisions: 5, seriousFalsePositives: 0 } }), "no_serious_false_positive_products")).toBe("insufficient_data");
    expect(status(stats({ productReview: { reviewedProductDecisions: 40, seriousFalsePositives: 1 } }), "no_serious_false_positive_products")).toBe("fail");
  });
  it("a swinging disagreement rate fails; fewer than 5 days is insufficient", () => {
    const swing = [5, 30, 8, 28, 6, 25].map((n, i) => ({ date: `2026-10-0${i + 1}`, decisions: 100, disagreements: n }));
    expect(status(stats({ daily: swing }), "stable_disagreement_rate")).toBe("fail");
    expect(status(stats({ daily: swing.slice(0, 3) }), "stable_disagreement_rate")).toBe("insufficient_data");
  });
  it("gates: unknown is insufficient, a failing run fails", () => {
    expect(status(stats({ gates: { tests: "pass", evals: "unknown" } }), "existing_evals_and_tests_pass")).toBe("insufficient_data");
    expect(status(stats({ gates: { tests: "fail", evals: "pass" } }), "existing_evals_and_tests_pass")).toBe("fail");
  });
  it("no data at all is never ready", () => {
    const r = evaluateExitCriteria(stats({ decisions: 0, daily: [], consent: { checked: 0, mismatches: 0 }, productReview: { reviewedProductDecisions: 0, seriousFalsePositives: 0 }, gates: { tests: "unknown", evals: "unknown" } }));
    expect(r.ready).toBe(false);
    expect(r.criteria.every((c) => c.status === "insufficient_data")).toBe(true);
  });
});

describe("decision outcome linking", () => {
  const dec = { id: "d1", clientId: "c1", createdAt: d(10), assetClass: "PMS", result: "RECOMMEND" };
  it("links events inside the window and records days after", () => {
    const out = linkOutcomes(dec, [{ kind: "contact", ref: "a1", at: d(8) }, { kind: "contact", ref: "a2", at: d(1) }, { kind: "kyc", ref: "k", at: d(2) }]);
    expect(out.map((o) => `${o.kind}:${o.daysAfter}`)).toEqual(["contact:2", "kyc:8"]);
  });
  it("ignores events before the decision", () => {
    expect(linkOutcomes(dec, [{ kind: "contact", ref: "a", at: d(11) }])).toEqual([]);
  });
  it("a conversation outcome about another asset class is not linked", () => {
    expect(linkOutcomes(dec, [{ kind: "interaction_outcome", ref: "o", at: d(9), assetClass: "Mutual Funds" }])).toEqual([]);
    expect(linkOutcomes(dec, [{ kind: "interaction_outcome", ref: "o", at: d(9), assetClass: "PMS" }])).toHaveLength(1);
  });
  it("an abstain decision links nothing", () => {
    expect(linkOutcomes({ ...dec, result: "ABSTAIN" }, [{ kind: "contact", ref: "a", at: d(9) }])).toEqual([]);
  });
  it("rates carry the correlation note and compare accept with ignored", () => {
    const r = outcomeRates([{ decisionId: "1", feedback: "accept", outcomeKinds: ["contact"] }, { decisionId: "2", feedback: null, outcomeKinds: [] }, { decisionId: "3", feedback: "ignored", outcomeKinds: ["contact"] }]);
    expect(r.afterAccept).toEqual({ decisions: 1, followedByContact: 1, followedByResponse: 0 });
    expect(r.afterIgnored.decisions).toBe(2);
    expect(r.note).toBe(CORRELATION_NOTE);
    expect(CORRELATION_NOTE).toMatch(/correlation is not causation/);
  });
});
