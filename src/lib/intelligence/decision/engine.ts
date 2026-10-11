// The Decision Engine pipeline: candidates (from adapters) -> suppression -> policy and consent -> rank -> explain.
// Pure and deterministic: no database, no clock beyond ctx.now, no randomness. Rules first, transparent heuristics, no model.
import { ENGINE_CONFIG, ENGINE_VERSION, FRESHNESS } from "./constants";
import type { GateContext } from "./gate-context";
import { resolveChannel, type ChannelResolution } from "./policy";
import { evaluateSuppression, type SuppressionResult } from "./suppression";
import type { AbstainReason, Alternative, Candidate, Confidence, DecisionDraft, EvidenceItem, PolicyResult, ScoreInput, Suppression } from "./types";

const NO_POLICY: PolicyResult = { consent: "ok", consentPurpose: null, consentReason: null, window: "not_applicable", guardrails: "ok", approvalNeeded: false, approver: null };
const TIER: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

/** Candidates the engine adds itself from the gate context (nothing a generator would know). */
export function syntheticCandidates(ctx: GateContext): Candidate[] {
  const out: Candidate[] = [];
  const base = { sales: false, serviceRecovery: true, assetClass: null, bonuses: [], asOf: ctx.now, freshness: { ...FRESHNESS.onboarding }, inferredOnly: false, productRefs: [], legacyChosen: false, source: "stage_gate" as const, owner: "RM" as const, channel: "none" as const };
  if (ctx.unreachableAttempts >= ENGINE_CONFIG.unreachableAttempts) {
    out.push({ ...base, id: "engine:verify_contact", programme: "Service / relationship follow-up", action: "Task", topic: "Verify contact details", reason: `Could not reach the customer ${ctx.unreachableAttempts} times: verify the phone number and the best time to call.`, priority: "Medium", timing: "This Week", ruleKey: "engine.verify_contact", fingerprint: `attempts:${ctx.unreachableAttempts}`, evidence: [{ kind: "event", ref: "contact:unreachable", text: `${ctx.unreachableAttempts} failed contact attempts recently`, observedAt: ctx.now.toISOString(), confirmation: "confirmed" }] });
  }
  if (ctx.kycException.open) {
    out.push({ ...base, id: "engine:exception_resolve", programme: "Complete KYC", action: "Follow-up", topic: "Resolve the exception", reason: `${ctx.kycException.label ?? "An onboarding exception is open"}: resolving it is the only next step.`, priority: "High", timing: "Today", ruleKey: "exception.resolve", fingerprint: ctx.kycException.label ?? "exception", bonuses: [{ label: "Blocking exception", points: 10 }], evidence: [{ kind: "fact", ref: "exception:open", text: ctx.kycException.label ?? "Open exception", observedAt: ctx.now.toISOString(), confirmation: "confirmed" }] });
  }
  return out;
}

function scoreOf(c: Candidate, penalties: ScoreInput[]): { score: number; inputs: ScoreInput[] } {
  const inputs: ScoreInput[] = [{ label: `Priority tier ${c.priority}`, points: ENGINE_CONFIG.baseScore[c.priority], kind: "base" }];
  let room = ENGINE_CONFIG.bonusCap;
  for (const b of c.bonuses) {
    const pts = Math.max(0, Math.min(b.points, room));
    if (pts > 0) inputs.push({ label: b.label, points: pts, kind: "bonus" });
    room -= pts;
  }
  inputs.push(...penalties);
  if (c.inferredOnly) inputs.push({ label: "Unconfirmed AI inference", points: -ENGINE_CONFIG.inferredPenalty, kind: "penalty" });
  const total = inputs.reduce((a, b) => a + b.points, 0);
  return { score: Math.max(0, Math.min(100, total)), inputs };
}

function confidenceOf(evidence: EvidenceItem[], inferredOnly: boolean): Confidence {
  if (inferredOnly) return "low";
  const counted = evidence.filter((e) => e.confirmation !== "not_applicable");
  if (counted.length === 0) return evidence.length ? "medium" : "low";
  const confirmed = counted.filter((e) => e.confirmation === "confirmed").length;
  if (confirmed === counted.length) return "high";
  return confirmed === 0 ? "low" : "medium";
}

type Survivor = { c: Candidate; res: ChannelResolution; sup: SuppressionResult; score: number; inputs: ScoreInput[] };

function shell(ctx: GateContext, over: Partial<DecisionDraft>): DecisionDraft {
  return {
    result: "NO_ACTION",
    abstainReason: null,
    escalation: null,
    action: "No Action",
    programme: "No Action / Do Not Pitch",
    topic: null,
    assetClass: null,
    reason: "",
    priority: "Low",
    priorityScore: 0,
    owner: "RM",
    channel: "none",
    timing: "Later",
    notBefore: null,
    confidence: "medium",
    evidence: [],
    scoreInputs: [],
    suppression: [],
    policyResult: NO_POLICY,
    alternatives: [],
    chosenCandidateId: null,
    candidateCount: 0,
    engineVersion: ENGINE_VERSION,
    observedAt: ctx.now.toISOString(),
    ...over,
  };
}

const trim = (s: string) => s.replace(/\.\s*$/, "");

export function decide(input: { ctx: GateContext; candidates: Candidate[]; factsMissing?: boolean }): DecisionDraft {
  const { ctx } = input;
  const seen = new Set<string>();
  const all = [...input.candidates, ...syntheticCandidates(ctx)].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const suppression: Suppression[] = [];
  const common = { suppression, candidateCount: all.length };

  // A compliance concern is a person's decision, not the engine's: hand over, recommend nothing, no AI draft.
  if (ctx.complianceConcernOpen) {
    for (const c of all) suppression.push({ rule: "compliance_concern", effect: "block", until: null, because: "A compliance concern is open on this customer", candidateId: c.id });
    return shell(ctx, { ...common, result: "ABSTAIN", abstainReason: "human_review_required", escalation: "manager_review", owner: "Manager", priority: "High", reason: "A compliance concern is open on this customer: a manager reviews it before anything is recommended.", evidence: [{ kind: "memory", ref: "insight:COMPLIANCE_CONCERN", text: "Open compliance concern", observedAt: ctx.now.toISOString(), confirmation: "confirmed" }] });
  }

  const survivors: Survivor[] = [];
  const blocked: { c: Candidate; why: string; rules: Set<string> }[] = [];
  let dndSeen = false;
  const conflicted: { c: Candidate; why: string }[] = [];

  for (const c0 of all) {
    const sup = evaluateSuppression(c0, ctx);
    suppression.push(...sup.suppressions);
    const hard = sup.suppressions.filter((s) => s.effect === "block");
    if (hard.length) {
      blocked.push({ c: c0, why: hard[0].because, rules: new Set(hard.map((h) => h.rule)) });
      continue;
    }
    const c: Candidate = sup.ownerOverride ? { ...c0, owner: sup.ownerOverride } : c0;
    const res = resolveChannel(c, ctx);
    suppression.push(...res.blocks);
    if (res.policy.guardrails === "flagged") {
      const s: Suppression = { rule: "compliance_concern", effect: "block", until: null, because: "The wording of this recommendation failed the copy guardrails (advice or return promise)", candidateId: c.id };
      suppression.push(s);
      blocked.push({ c, why: s.because, rules: new Set(["compliance_concern"]) });
      continue;
    }
    if (res.channel === null) {
      if (res.blocks.some((b) => b.rule === "consent_dnd" && /do not contact/.test(b.because))) dndSeen = true;
      blocked.push({ c, why: res.blocks[0]?.because ?? "No channel is allowed", rules: new Set(res.blocks.map((b) => b.rule)) });
      continue;
    }
    const conflict = ctx.evidenceConflicts.find((e) => e.assetClass !== null && e.assetClass === c.assetClass);
    if (conflict) {
      conflicted.push({ c, why: conflict.because });
      continue;
    }
    const { score, inputs } = scoreOf(c, sup.penalties);
    survivors.push({ c, res, sup, score, inputs });
  }

  survivors.sort((a, b) => Number(a.c.inferredOnly) - Number(b.c.inferredOnly) || b.score - a.score || (TIER[b.c.priority] ?? 0) - (TIER[a.c.priority] ?? 0) || a.c.id.localeCompare(b.c.id));

  const alternativesFor = (winnerId: string | null): Alternative[] => {
    const runnerUps: Alternative[] = survivors.filter((s) => s.c.id !== winnerId).map((s) => ({ candidateId: s.c.id, programme: s.c.programme, action: s.res.action, topic: s.c.topic, blockedBy: null }));
    const stopped: Alternative[] = [...blocked, ...conflicted.map((x) => ({ ...x, rules: new Set<string>(), why: `Evidence conflicts: ${x.why}` }))]
      .sort((a, b) => (TIER[b.c.priority] ?? 0) - (TIER[a.c.priority] ?? 0) || a.c.id.localeCompare(b.c.id))
      .map((b) => ({ candidateId: b.c.id, programme: b.c.programme, action: b.c.action, topic: b.c.topic, blockedBy: b.why }));
    return [...runnerUps, ...stopped].slice(0, ENGINE_CONFIG.maxAlternatives);
  };

  if (survivors.length === 0) {
    const firstWhy = blocked[0]?.why ?? conflicted[0]?.why ?? null;
    if (conflicted.length > 0 && blocked.length === 0) {
      return shell(ctx, { ...common, result: "ABSTAIN", abstainReason: "evidence_conflict", reason: `The evidence conflicts, so nothing is recommended: ${trim(conflicted[0].why)}.`, alternatives: alternativesFor(null), evidence: [{ kind: "memory", ref: "conflict", text: conflicted[0].why, observedAt: ctx.now.toISOString(), confirmation: "confirmed" }] });
    }
    if (dndSeen) {
      return shell(ctx, { ...common, result: "ABSTAIN", abstainReason: "do_not_contact", reason: "The customer is on do not contact: no outreach is recommended.", alternatives: alternativesFor(null), evidence: [{ kind: "rule", ref: "consent:do_not_contact", text: "Do not contact is on for every channel", observedAt: ctx.now.toISOString(), confirmation: "confirmed" }] });
    }
    if (blocked.length > 0 && blocked.every((b) => b.rules.size > 0 && [...b.rules].every((r) => r === "data_stale"))) {
      return shell(ctx, { ...common, result: "ABSTAIN", abstainReason: "data_stale", reason: "The data behind the possible actions is too old to rely on: refresh it before deciding.", alternatives: alternativesFor(null), evidence: [{ kind: "rule", ref: "freshness", text: blocked[0].why, observedAt: ctx.now.toISOString(), confirmation: "not_applicable" }] });
    }
    if (all.length === 0 && input.factsMissing) {
      return shell(ctx, { ...common, result: "ABSTAIN", abstainReason: "do_not_know", reason: "There is not enough information about this customer to recommend anything.", evidence: [] });
    }
    return shell(ctx, {
      ...common,
      result: "NO_ACTION",
      reason: firstWhy ? `Nothing to do right now, because ${trim(firstWhy.charAt(0).toLowerCase() + firstWhy.slice(1))}.` : "Nothing to do right now: no rule found anything that needs doing.",
      alternatives: alternativesFor(null),
      evidence: firstWhy ? [{ kind: "rule", ref: `suppression:${[...(blocked[0]?.rules ?? [])][0] ?? "none"}`, text: firstWhy, observedAt: ctx.now.toISOString(), confirmation: "not_applicable" }] : [],
    });
  }

  const win = survivors[0];
  const c = win.c;
  const delayed = win.sup.notBefore;
  const evidence: EvidenceItem[] = [...c.evidence];
  if (win.res.channel !== "none" && win.res.policy.consentPurpose) {
    evidence.push({ kind: "rule", ref: `consent:${win.res.channel}`, text: `Consent check passed for ${win.res.channel} (${win.res.policy.consentPurpose.toLowerCase().replace(/_/g, " ")})`, observedAt: ctx.now.toISOString(), confirmation: "not_applicable" });
  }

  if (c.inferredOnly) {
    const question = `Ask the customer to confirm: ${c.topic ?? c.programme}. This rests only on an AI reading of a conversation and has not been confirmed, so no pitch is recommended.`;
    return shell(ctx, {
      ...common,
      result: "RECOMMEND",
      action: "Review",
      programme: c.programme,
      topic: c.topic,
      assetClass: c.assetClass,
      reason: question,
      priority: "Low",
      priorityScore: Math.min(win.score, 30),
      owner: "RM",
      channel: "none",
      timing: "This Week",
      confidence: "low",
      evidence,
      scoreInputs: win.inputs,
      policyResult: NO_POLICY,
      alternatives: alternativesFor(c.id),
      chosenCandidateId: c.id,
    });
  }

  return shell(ctx, {
    ...common,
    result: "RECOMMEND",
    action: win.res.action,
    programme: c.programme,
    topic: c.topic,
    assetClass: c.assetClass,
    reason: win.res.action !== c.action ? `${trim(c.reason)}. (Switched to ${win.res.action.toLowerCase()} because ${c.action.toLowerCase()} is not allowed right now.)` : c.reason,
    priority: c.priority,
    priorityScore: win.score,
    owner: c.owner,
    channel: win.res.channel as DecisionDraft["channel"],
    timing: delayed ? "Trigger-based" : c.timing,
    notBefore: delayed ? delayed.toISOString() : null,
    confidence: confidenceOf(c.evidence, false),
    evidence,
    scoreInputs: win.inputs,
    policyResult: win.res.policy,
    alternatives: alternativesFor(c.id),
    chosenCandidateId: c.id,
  });
}

export type { AbstainReason };
