import { describe, expect, it } from "vitest";
import { consentDecision, type ConsentRow } from "@/lib/consent/decision";
import { ENGINE_VERSION } from "./constants";
import { decide, syntheticCandidates } from "./engine";
import { emptyGateContext, type GateContext } from "./gate-context";
import { cand, daysAgo, hoursAgo, NOW } from "./test-helpers";

const consent = (over: Partial<ConsentRow> = {}): ConsentRow => ({ purpose: "MARKETING_COMMS", channel: null, status: "GRANTED", capturedAt: daysAgo(30), ...over });
const ctx = (over: Partial<GateContext> = {}, rows: ConsentRow[] = [consent(), consent({ purpose: "SERVICE_COMMS" })]): GateContext => ({ ...emptyGateContext("c1", NOW), ...over, consent: { rows, legacyMarketingConsentAt: null } });
const service = (over = {}) => cand({ id: "intelligence_nba:service", programme: "Service / relationship follow-up", assetClass: null, sales: false, serviceRecovery: true, owner: "Support", action: "Call", priority: "High", ruleKey: "intelligence_nba.service", fingerprint: "svc", ...over });

describe("decision engine", () => {
  it("recommends the highest scored survivor and stamps the engine version and as-of", () => {
    const d = decide({ ctx: ctx(), candidates: [cand({ id: "a", priority: "Low", assetClass: "AIF", fingerprint: "AIF" }), cand({ id: "b", priority: "High" })] });
    expect(d.result).toBe("RECOMMEND");
    expect(d.chosenCandidateId).toBe("b");
    expect(d.engineVersion).toBe(ENGINE_VERSION);
    expect(d.observedAt).toBe(NOW.toISOString());
    expect(d.priorityScore).toBeGreaterThan(50);
  });

  it("is deterministic: the same input gives the same decision", () => {
    const input = { ctx: ctx(), candidates: [cand({ id: "a", priority: "Medium" }), cand({ id: "b", priority: "Medium", assetClass: "AIF", fingerprint: "AIF" })] };
    expect(decide(input)).toEqual(decide(input));
  });

  it("score inputs list the base and every bonus, and the score is capped at 100", () => {
    const d = decide({ ctx: ctx(), candidates: [cand({ priority: "High", bonuses: [{ label: "KYC pending over 3 days", points: 10 }, { label: "RM-confirmed interest", points: 10 }, { label: "Goal off track", points: 8 }, { label: "Idle cash", points: 5 }] })] });
    expect(d.scoreInputs[0]).toEqual({ label: "Priority tier High", points: 75, kind: "base" });
    expect(d.scoreInputs.filter((s) => s.kind === "bonus").reduce((a, b) => a + b.points, 0)).toBeLessThanOrEqual(25);
    expect(d.priorityScore).toBeLessThanOrEqual(100);
  });

  describe("suppression", () => {
    it("a declined class is never the winner and is recorded with the plain reason", () => {
      const g = ctx({ declined: [{ assetClass: "PMS", because: "Customer declined PMS on 3 Oct" }] });
      const d = decide({ ctx: g, candidates: [cand({ id: "pms", priority: "High" }), cand({ id: "mf", priority: "Low", assetClass: "Mutual Funds", fingerprint: "MF", programme: "MF / SIP opportunity" })] });
      expect(d.chosenCandidateId).toBe("mf");
      expect(d.suppression.find((s) => s.candidateId === "pms")?.because).toContain("declined PMS on 3 Oct");
      expect(d.alternatives.find((a) => a.candidateId === "pms")?.blockedBy).toContain("declined PMS");
    });

    it("an open complaint leaves only service recovery", () => {
      const g = ctx({ complaint: { open: true, lastAt: daysAgo(1), because: "Open complaint about a statement" } });
      const d = decide({ ctx: g, candidates: [cand({ id: "pms", priority: "High" }), service()] });
      expect(d.chosenCandidateId).toBe("intelligence_nba:service");
      expect(d.owner).toBe("Support");
      expect(d.suppression.some((s) => s.rule === "open_complaint" && s.candidateId === "pms")).toBe(true);
    });

    it("a recent contact delays: Trigger-based timing and a not-before time", () => {
      const d = decide({ ctx: ctx({ lastContactAt: hoursAgo(5) }), candidates: [cand()] });
      expect(d.timing).toBe("Trigger-based");
      expect(d.notBefore).not.toBeNull();
      expect(d.suppression[0].effect).toBe("delay");
    });

    it("with every candidate blocked the result is No Action, said plainly with the reason", () => {
      const d = decide({ ctx: ctx({ declined: [{ assetClass: "PMS", because: "Customer declined PMS on 3 Oct" }] }), candidates: [cand()] });
      expect(d.result).toBe("NO_ACTION");
      expect(d.action).toBe("No Action");
      expect(d.programme).toBe("No Action / Do Not Pitch");
      expect(d.reason).toMatch(/^Nothing to do right now, because /);
      expect(d.reason).toContain("declined PMS");
      expect(d.channel).toBe("none");
    });

    it("no candidates at all is No Action as well", () => {
      const d = decide({ ctx: ctx(), candidates: [] });
      expect(d.result).toBe("NO_ACTION");
      expect(d.reason).toMatch(/^Nothing to do right now/);
    });
  });

  describe("policy", () => {
    it("falls back from a blocked channel and changes the action to match", () => {
      const rows = [consent(), consent({ channel: "whatsapp", status: "WITHDRAWN", capturedAt: daysAgo(1) })];
      const d = decide({ ctx: ctx({}, rows), candidates: [cand({ channel: "whatsapp", action: "WhatsApp" })] });
      expect(d.channel).toBe("call");
      expect(d.action).toBe("Call");
      expect(d.suppression.some((s) => s.rule === "consent_dnd")).toBe(true);
    });

    it("do not contact everywhere abstains with do_not_contact (not a plain No Action)", () => {
      const d = decide({ ctx: ctx({}, [consent({ purpose: "DO_NOT_CONTACT" })]), candidates: [cand(), service({ sales: false })] });
      expect(d.result).toBe("ABSTAIN");
      expect(d.abstainReason).toBe("do_not_contact");
      expect(d.channel).toBe("none");
    });

    it("a candidate whose reason fails the copy guardrails is dropped", () => {
      const d = decide({ ctx: ctx(), candidates: [cand({ id: "bad", reason: "Guaranteed returns on this PMS", priority: "High" }), cand({ id: "ok", assetClass: "AIF", fingerprint: "AIF", priority: "Low" })] });
      expect(d.chosenCandidateId).toBe("ok");
      expect(d.suppression.some((s) => s.candidateId === "bad" && s.rule === "compliance_concern")).toBe(true);
    });

    it("an AI Bot owned winner needs approval", () => {
      const d = decide({ ctx: ctx({ lastInboundWhatsAppAt: hoursAgo(1) }), candidates: [cand({ owner: "AI Bot", sales: false, assetClass: null, programme: "Complete KYC", channel: "whatsapp", action: "WhatsApp" })] });
      expect(d.policyResult.approvalNeeded).toBe(true);
      expect(d.owner).toBe("AI Bot");
    });

    it("the agent switched off turns an AI Bot owner into a person", () => {
      const d = decide({ ctx: ctx({ agentEnabled: false, lastInboundWhatsAppAt: hoursAgo(1) }), candidates: [cand({ owner: "AI Bot", sales: false, assetClass: null, programme: "Complete KYC", channel: "whatsapp", action: "WhatsApp" })] });
      expect(d.owner).toBe("CRM");
      expect(d.policyResult.approvalNeeded).toBe(false);
    });
  });

  describe("abstain", () => {
    it("a compliance concern hands the customer to manager review and recommends nothing", () => {
      const d = decide({ ctx: ctx({ complianceConcernOpen: true }), candidates: [cand({ priority: "High" })] });
      expect(d.result).toBe("ABSTAIN");
      expect(d.abstainReason).toBe("human_review_required");
      expect(d.escalation).toBe("manager_review");
      expect(d.owner).not.toBe("AI Bot");
    });

    it("conflicting evidence on the topic abstains with evidence_conflict", () => {
      const d = decide({ ctx: ctx({ evidenceConflicts: [{ assetClass: "PMS", because: "Interest (2 Oct) and a decline (28 Sep) are both open for PMS" }] }), candidates: [cand({ priority: "High" })] });
      expect(d.result).toBe("ABSTAIN");
      expect(d.abstainReason).toBe("evidence_conflict");
      expect(d.reason).toContain("Interest");
    });

    it("when stale data is the only thing blocking, abstain with data_stale", () => {
      const d = decide({ ctx: ctx(), candidates: [cand({ asOf: daysAgo(90), freshness: { softDays: 14, hardDays: 60 } })] });
      expect(d.result).toBe("ABSTAIN");
      expect(d.abstainReason).toBe("data_stale");
    });

    it("no candidates and no facts to go on is do_not_know only when asked to (facts missing)", () => {
      const d = decide({ ctx: ctx(), candidates: [], factsMissing: true });
      expect(d.result).toBe("ABSTAIN");
      expect(d.abstainReason).toBe("do_not_know");
    });
  });

  describe("AI-inferred evidence", () => {
    it("an inferred-only candidate can only prompt a question: Review, low confidence, no send", () => {
      const inferred = cand({ id: "inf", inferredOnly: true, channel: "whatsapp", action: "WhatsApp", priority: "High", evidence: [{ kind: "memory", ref: "insight:INTEREST:PMS", text: "AI read interest in PMS", observedAt: NOW.toISOString(), confirmation: "ai_inferred" }] });
      const d = decide({ ctx: ctx({ lastInboundWhatsAppAt: hoursAgo(1) }), candidates: [inferred] });
      expect(d.action).toBe("Review");
      expect(d.channel).toBe("none");
      expect(d.confidence).toBe("low");
      expect(d.reason).toMatch(/confirm/i);
    });
    it("an inferred-only candidate loses to a confirmed one even at a higher tier", () => {
      const inferred = cand({ id: "inf", inferredOnly: true, priority: "High", evidence: [{ kind: "memory", ref: "i", text: "x", observedAt: null, confirmation: "ai_inferred" }] });
      const confirmed = cand({ id: "conf", priority: "Medium", assetClass: "AIF", fingerprint: "AIF" });
      expect(decide({ ctx: ctx(), candidates: [inferred, confirmed] }).chosenCandidateId).toBe("conf");
    });
  });

  describe("confidence labels", () => {
    const ev = (confirmation: "confirmed" | "ai_inferred" | "not_applicable") => ({ kind: "fact" as const, ref: "r", text: "t", observedAt: null, confirmation });
    it("confirmed evidence is high, mixed is medium, rule-only is medium", () => {
      expect(decide({ ctx: ctx(), candidates: [cand({ evidence: [ev("confirmed")] })] }).confidence).toBe("high");
      expect(decide({ ctx: ctx(), candidates: [cand({ evidence: [ev("confirmed"), ev("ai_inferred")] })] }).confidence).toBe("medium");
      expect(decide({ ctx: ctx(), candidates: [cand({ evidence: [ev("not_applicable")] })] }).confidence).toBe("medium");
    });
  });

  describe("synthetic candidates", () => {
    it("unreachable twice adds a task to verify contact details", () => {
      const out = syntheticCandidates(ctx({ unreachableAttempts: 2 }));
      expect(out.map((c) => c.id)).toContain("engine:verify_contact");
      const d = decide({ ctx: ctx({ unreachableAttempts: 2 }), candidates: [cand()] });
      expect(d.action).toBe("Task");
      expect(d.reason).toMatch(/verify/i);
    });
    it("an open KYC exception adds the resolution step and it wins", () => {
      const d = decide({ ctx: ctx({ kycException: { open: true, label: "KYC rejected: PAN mismatch" } }), candidates: [cand({ priority: "High" })] });
      expect(d.action).toBe("Follow-up");
      expect(d.reason).toContain("PAN mismatch");
    });
  });

  describe("equivalent candidates from different implementations", () => {
    it("are merged into one: evidence is combined, the duplicate is not listed as an alternative", () => {
      const ev = (ref: string, confirmation: "confirmed" | "not_applicable") => ({ kind: "fact" as const, ref, text: ref, observedAt: null, confirmation });
      const a = cand({ id: "intelligence_nba:kyc", source: "intelligence_nba", programme: "Complete KYC", assetClass: null, sales: false, action: "Call", priority: "High", evidence: [ev("rule:a", "not_applicable")], fingerprint: "x" });
      const b = cand({ id: "stage_gate:kyc", source: "stage_gate", programme: "Complete KYC", assetClass: null, sales: false, action: "Call", priority: "High", evidence: [ev("stage:KYC", "confirmed")], fingerprint: "y" });
      const d = decide({ ctx: ctx(), candidates: [a, b] });
      expect(d.chosenCandidateId).toBe("intelligence_nba:kyc");
      expect(d.evidence.map((e) => e.ref)).toEqual(expect.arrayContaining(["rule:a", "stage:KYC"]));
      expect(d.evidence.some((e) => e.ref === "merged:stage_gate")).toBe(true);
      expect(d.confidence).toBe("high");
      expect(d.alternatives.map((x) => x.candidateId)).not.toContain("stage_gate:kyc");
    });
    it("different programmes or classes are not merged", () => {
      const d = decide({ ctx: ctx(), candidates: [cand({ id: "a" }), cand({ id: "b", assetClass: "AIF", fingerprint: "AIF" })] });
      expect(d.alternatives.map((x) => x.candidateId)).toContain("b");
    });
  });

  it("property: a recommendation never uses a channel the ledger would block", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
    for (let i = 0; i < 400; i++) {
      const rows: ConsentRow[] = [];
      for (const purpose of ["MARKETING_COMMS", "SERVICE_COMMS", "DO_NOT_CONTACT"]) {
        if (rnd() < 0.5) rows.push({ purpose, channel: pick([null, "call", "whatsapp", "email"]), status: pick(["GRANTED", "WITHDRAWN"]), capturedAt: daysAgo(Math.floor(rnd() * 90)) });
      }
      const channel = pick(["call", "whatsapp", "email", "none"] as const);
      const sales = rnd() < 0.6;
      const g = ctx({ lastInboundWhatsAppAt: rnd() < 0.5 ? hoursAgo(Math.floor(rnd() * 60)) : null, approvedTemplateExists: rnd() < 0.5 }, rows);
      const c = cand({ channel, sales, action: channel === "whatsapp" ? "WhatsApp" : channel === "email" ? "Email" : channel === "none" ? "Review" : "Call" });
      const d = decide({ ctx: g, candidates: [c] });
      if (d.result === "RECOMMEND" && d.channel !== "none" && d.policyResult.consentPurpose) {
        const ok = consentDecision(g.consent.rows, d.policyResult.consentPurpose as "MARKETING_COMMS", d.channel === "in_person" ? "call" : d.channel, NOW, {});
        expect(ok.allowed, JSON.stringify({ rows, channel, sales, d: d.channel })).toBe(true);
      }
    }
  });
});
