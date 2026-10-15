import { describe, expect, it } from "vitest";
import type { NextBestAction } from "@/lib/copilot/next-best-action";
import type { Suggestion } from "@/lib/outcomes/types";
import { makeFacts } from "@/test/factories";
import type { NextBestActionV2 } from "../../nba";
import { agentProposalCandidates, assetClassFor, crossSellCandidates, disengagementCandidates, generateCandidates, goalOutcomeCandidates, intelligenceNbaCandidates, stageGateCandidates, stageNextActionCandidates } from "./adapters";
import type { AdapterInput } from "./types";

const now = new Date("2026-10-09T10:00:00Z");
const base = (over: Partial<AdapterInput> = {}): AdapterInput => ({ now, facts: makeFacts(), nba: null, stageGate: null, goalSuggestions: [], nextAction: null, proposals: [], crossSell: [], portfolioAsOf: now, ...over });
const nba = (over: Partial<NextBestActionV2> = {}): NextBestActionV2 => ({ programme: "PMS / AIF opportunity", action: "Call", topic: "PMS", reason: "PMS acceptance is high.", priority: "Medium", owner: "RM", timing: "This Week", priorityScore: 58, talkingPoints: [], doNotDiscuss: [], blockedKeys: [], ...over });
const gate = (over: Partial<NextBestAction> = {}): NextBestAction => ({ kind: "follow_up_kyc", label: "Follow up on KYC", detail: "KYC submission is pending review.", suggestedTemplateCategory: "kyc_reminder", ...over });
const sugg = (over: Partial<Suggestion> = {}): Suggestion => ({ ruleKey: "review_overdue", fingerprint: "2026-04", title: "Portfolio review overdue", detail: "Last review 190 days ago.", severity: "medium", rank: 60, why: [{ label: "Last review", value: "190 days ago" }], task: { title: "Review", dueInDays: 7 }, draft: "review_overdue", ...over });

describe("candidate adapters over the existing implementations", () => {
  describe("stage gate (copilot)", () => {
    it("maps each actionable kind and drops no_action_needed", () => {
      expect(stageGateCandidates(base({ stageGate: gate({ kind: "no_action_needed" }) }))).toEqual([]);
      const [c] = stageGateCandidates(base({ stageGate: gate({ kind: "resolve_kyc_issue", suggestedTemplateCategory: "kyc_reminder" }) }));
      expect(c.ruleKey).toBe("stage_gate.resolve_kyc_issue");
      expect(c.programme).toBe("Complete KYC");
      expect(c.priority).toBe("High");
      expect(c.sales).toBe(false);
    });
    it("a KYC reminder after first contact is a CRM WhatsApp; an internal step has no channel", () => {
      const [wa] = stageGateCandidates(base({ stageGate: gate({ kind: "collect_documents", suggestedTemplateCategory: "document_reminder" }) }));
      expect(wa.action).toBe("WhatsApp");
      expect(wa.owner).toBe("CRM");
      const [internal] = stageGateCandidates(base({ stageGate: gate({ kind: "submit_kyc", suggestedTemplateCategory: null }) }));
      expect(internal.channel).toBe("none");
    });
  });

  describe("intelligence NBA v1", () => {
    it("wraps the current opinion and marks it as the legacy choice", () => {
      const [c] = intelligenceNbaCandidates(base({ nba: nba() }));
      expect(c.legacyChosen).toBe(true);
      expect(c.assetClass).toBe("PMS");
      expect(c.sales).toBe(true);
      expect(c.bonuses[0].points).toBe(8);
    });
    it("No Action produces no candidate", () => {
      expect(intelligenceNbaCandidates(base({ nba: nba({ action: "No Action", programme: "No Action / Do Not Pitch" }) }))).toEqual([]);
    });
    it("interest that only an AI conversation reading supports is inferred-only; an RM-confirmed one is not", () => {
      const insight = { id: "i1", kind: "INTEREST", assetClass: "PMS", text: "t", status: "OPEN", dueAt: null, severity: null, occurredAt: new Date("2026-10-05"), sourceType: "CALL" };
      const aiOnly = intelligenceNbaCandidates(base({ nba: nba(), facts: makeFacts({ insights: [insight] }) }))[0];
      expect(aiOnly.inferredOnly).toBe(true);
      const confirmed = intelligenceNbaCandidates(base({ nba: nba(), facts: makeFacts({ insights: [insight], outcomes: [{ outcome: "INTERESTED", assetClass: "PMS", createdAt: new Date("2026-10-06") }] }) }))[0];
      expect(confirmed.inferredOnly).toBe(false);
    });
    it("a service follow-up is service recovery, not sales", () => {
      const [c] = intelligenceNbaCandidates(base({ nba: nba({ programme: "Service / relationship follow-up", topic: "Resolve the open issue", owner: "Support" }) }));
      expect(c.serviceRecovery).toBe(true);
      expect(c.sales).toBe(false);
      expect(c.owner).toBe("Support");
    });
    it("portfolio based candidates carry the snapshot age so staleness can apply", () => {
      const old = new Date("2026-08-01");
      const [c] = intelligenceNbaCandidates(base({ nba: nba({ programme: "Portfolio rebalance", topic: "x" }), portfolioAsOf: old }));
      expect(c.asOf).toEqual(old);
      expect(c.freshness.hardDays).toBe(30);
    });
  });

  describe("goal and outcomes rules", () => {
    it("keeps the outcomes (ruleKey, fingerprint) so an existing dismissal still applies", () => {
      const [c] = goalOutcomeCandidates(base({ goalSuggestions: [sugg()] }));
      expect(c.ruleKey).toBe("review_overdue");
      expect(c.fingerprint).toBe("2026-04");
      expect(c.evidence.some((e) => e.text.includes("190 days"))).toBe(true);
    });
    it("a promise overdue is service recovery; idle cash is a sales step", () => {
      expect(goalOutcomeCandidates(base({ goalSuggestions: [sugg({ ruleKey: "key_date", fingerprint: "commitment:x" })] }))[0].serviceRecovery).toBe(true);
      expect(goalOutcomeCandidates(base({ goalSuggestions: [sugg({ ruleKey: "idle_cash", fingerprint: "i" })] }))[0].sales).toBe(true);
    });
    it("ignores a rule it does not know", () => {
      expect(goalOutcomeCandidates(base({ goalSuggestions: [sugg({ ruleKey: "brand_new_rule" })] }))).toEqual([]);
    });
  });

  it("stage-engine next action becomes a task candidate, high when overdue", () => {
    const [c] = stageNextActionCandidates(base({ nextAction: { title: "Send KYC form", dueAt: new Date("2026-10-01") } }));
    expect(c.action).toBe("Task");
    expect(c.priority).toBe("High");
    expect(c.serviceRecovery).toBe(true); // an RM's own task is never suppressed by a complaint
    expect(stageNextActionCandidates(base())).toEqual([]);
  });

  it("agent drafts become AI Bot candidates that still need approval", () => {
    const [c] = agentProposalCandidates(base({ proposals: [{ id: "p1", programme: "Complete KYC", channel: "whatsapp", reason: "KYC reminder", createdAt: now }] }));
    expect(c.owner).toBe("AI Bot");
    expect(c.action).toBe("WhatsApp");
    expect(c.programme).toBe("Complete KYC");
  });

  it("cross-sell flags become low-priority review candidates", () => {
    const out = crossSellCandidates(base({ crossSell: [{ label: "Consider premium advisory / PMS", reason: "High investment capacity" }, { label: "Unknown flag", reason: "x" }] }));
    expect(out).toHaveLength(1);
    expect(out[0].programme).toBe("PMS / AIF opportunity");
    expect(out[0].priority).toBe("Low");
  });

  it("disengagement needs an ACTIVE customer quiet for 5 days or more", () => {
    const f = makeFacts();
    f.lastActivityAt = new Date(now.getTime() - 6 * 86400000);
    expect(disengagementCandidates(base({ facts: f }))).toHaveLength(1);
    f.lastActivityAt = new Date(now.getTime() - 2 * 86400000);
    expect(disengagementCandidates(base({ facts: f }))).toHaveLength(0);
  });

  it("generateCandidates concatenates every adapter and ids are unique", () => {
    const f = makeFacts();
    f.lastActivityAt = new Date(now.getTime() - 9 * 86400000);
    const out = generateCandidates(base({ facts: f, nba: nba(), stageGate: gate(), goalSuggestions: [sugg()], nextAction: { title: "T", dueAt: null }, proposals: [{ id: "p", programme: null, channel: "whatsapp", reason: "r", createdAt: now }] }));
    expect(new Set(out.map((c) => c.source))).toEqual(new Set(["stage_gate", "intelligence_nba", "goal_outcomes", "stage_next_action", "agent_proposal", "disengagement"]));
    expect(new Set(out.map((c) => c.id)).size).toBe(out.length);
  });

  it("assetClassFor maps programmes to a class", () => {
    expect(assetClassFor("PMS / AIF opportunity", "AIF")).toBe("AIF");
    expect(assetClassFor("MF / SIP opportunity", null)).toBe("Mutual Funds");
    expect(assetClassFor("Complete KYC", null)).toBeNull();
  });
});
