// DECISION REPLAY: run the engine over historical snapshots and report agreement, suppression and outcome statistics, before and during shadow.
//
// HONEST LIMIT (printed in every report): the snapshot date moves the clock and the event history (contact, messages, consent, complaints,
// dismissals, outcomes, calls) back to that date, but state-like facts (stage, KYC and funding status, holdings, the manual next action,
// open exceptions) are today's values: the database does not keep their history. So this is a rule regression test on real event
// history, not a time machine. Outcome numbers are correlations, never causes.
import type { CustomerFacts } from "../facts";
import { buildDecision } from "./shadow";
import type { DecisionInput } from "./loader";
import { DAY_MS } from "./constants";
import { CORRELATION_NOTE, linkOutcomes, type LaterEvent } from "./outcome-linking";

export type ReplayPoint = { clientId: string; asOf: Date };

export type ReplayDeps = {
  loadInput: (clientId: string, asOf: Date) => Promise<DecisionInput | null>;
  laterEvents: (clientId: string, from: Date, to: Date) => Promise<LaterEvent[]>;
  now: Date;
};

type Group = { decisions: number; followedByContact: number; followedByResponse: number };
const group = (): Group => ({ decisions: 0, followedByContact: 0, followedByResponse: 0 });

export type ReplayReport = {
  generatedAt: string;
  params: { points: number; windowDays: number };
  evaluated: number;
  skipped: number;
  results: Record<string, number>;
  abstainReasons: Record<string, number>;
  agreement: { agree: number; disagree: number; ratePct: number };
  disagreementKinds: Record<string, number>;
  materialRegressions: { clientId: string; asOf: string; summary: string }[];
  suppression: { candidates: number; blockedCandidates: number; byRule: Record<string, number>; byEffect: Record<string, number> };
  channelFallbacks: number;
  outcomes: { windowDays: number; byResult: Record<string, Group>; byAgreement: { agree: Group; disagree: Group }; v2HoldsBackWhereLegacyActed: Group; note: string };
  limits: string[];
};

export const REPLAY_LIMITS = [
  "State-like facts (stage, KYC and funding status, holdings, manual next action, open exceptions) are today's values, not the values on the snapshot date.",
  "Event history (contact, messages, consent, complaints, dismissals, calls, outcomes) is cut at the snapshot date.",
  "Outcome numbers are correlations. RM skill and the customer's own choices drive them; nothing here says the engine caused them.",
];

const bump = (g: Group, kinds: string[]) => {
  g.decisions += 1;
  if (kinds.includes("contact") || kinds.includes("interaction_outcome")) g.followedByContact += 1;
  if (kinds.includes("response")) g.followedByResponse += 1;
};

export async function replay(points: ReplayPoint[], deps: ReplayDeps, opts: { outcomeWindowDays?: number } = {}): Promise<ReplayReport> {
  const windowDays = opts.outcomeWindowDays ?? 7;
  const rep: ReplayReport = {
    generatedAt: deps.now.toISOString(),
    params: { points: points.length, windowDays },
    evaluated: 0,
    skipped: 0,
    results: { RECOMMEND: 0, NO_ACTION: 0, ABSTAIN: 0 },
    abstainReasons: {},
    agreement: { agree: 0, disagree: 0, ratePct: 0 },
    disagreementKinds: {},
    materialRegressions: [],
    suppression: { candidates: 0, blockedCandidates: 0, byRule: {}, byEffect: {} },
    channelFallbacks: 0,
    outcomes: { windowDays, byResult: { RECOMMEND: group(), NO_ACTION: group(), ABSTAIN: group() }, byAgreement: { agree: group(), disagree: group() }, v2HoldsBackWhereLegacyActed: group(), note: CORRELATION_NOTE },
    limits: REPLAY_LIMITS,
  };

  for (const p of points) {
    const input = await deps.loadInput(p.clientId, p.asOf);
    if (!input) {
      rep.skipped += 1;
      continue;
    }
    const built = buildDecision(input);
    const d = built.draft;
    rep.evaluated += 1;
    rep.results[d.result] += 1;
    if (d.abstainReason) rep.abstainReasons[d.abstainReason] = (rep.abstainReasons[d.abstainReason] ?? 0) + 1;
    const dis = built.disagreement;
    if (dis.agrees) rep.agreement.agree += 1;
    else {
      rep.agreement.disagree += 1;
      rep.disagreementKinds[dis.kind] = (rep.disagreementKinds[dis.kind] ?? 0) + 1;
    }
    if (dis.severity === "material" && rep.materialRegressions.length < 50) rep.materialRegressions.push({ clientId: p.clientId, asOf: p.asOf.toISOString(), summary: dis.summary });
    rep.suppression.candidates += d.candidateCount;
    const blocked = new Set(d.suppression.filter((s) => s.effect === "block").map((s) => s.candidateId));
    rep.suppression.blockedCandidates += blocked.size;
    for (const s of d.suppression) {
      rep.suppression.byRule[s.rule] = (rep.suppression.byRule[s.rule] ?? 0) + 1;
      rep.suppression.byEffect[s.effect] = (rep.suppression.byEffect[s.effect] ?? 0) + 1;
    }
    const chosen = built.candidates.find((c) => c.id === d.chosenCandidateId);
    if (chosen && chosen.action !== d.action) rep.channelFallbacks += 1;

    // What happened next on this customer (only where the follow-up window has fully passed).
    const end = new Date(p.asOf.getTime() + windowDays * DAY_MS);
    if (end.getTime() <= deps.now.getTime()) {
      const events = await deps.laterEvents(p.clientId, p.asOf, end);
      const kinds = linkOutcomes({ id: "replay", clientId: p.clientId, createdAt: p.asOf, assetClass: d.assetClass, result: d.result === "ABSTAIN" ? "NO_ACTION" : d.result }, events).map((o) => o.kind);
      bump(rep.outcomes.byResult[d.result], kinds);
      bump(dis.agrees ? rep.outcomes.byAgreement.agree : rep.outcomes.byAgreement.disagree, kinds);
      if (dis.kind === "v2_holds_back" || dis.kind === "v2_abstains") bump(rep.outcomes.v2HoldsBackWhereLegacyActed, kinds);
    }
  }
  const total = rep.agreement.agree + rep.agreement.disagree;
  rep.agreement.ratePct = total === 0 ? 0 : Math.round((1000 * rep.agreement.agree) / total) / 10;
  return rep;
}

/**
 * Moves a customer's event history back to `asOf` (pure). State-like fields are left alone (see the limit above).
 * `lastActivityAt` is supplied by the caller from the activity table at that date.
 */
export function rewindFacts(facts: CustomerFacts, asOf: Date, lastActivityAt: Date | null): CustomerFacts {
  const t = asOf.getTime();
  return {
    ...facts,
    now: asOf,
    insights: facts.insights.filter((i) => i.occurredAt.getTime() <= t),
    outcomes: facts.outcomes.filter((o) => o.createdAt.getTime() <= t),
    manualAcceptance: facts.manualAcceptance.filter((m) => m.updatedAt.getTime() <= t),
    opportunities: facts.opportunities.filter((o) => o.updatedAt.getTime() <= t),
    lastActivityAt,
  };
}

/** Evenly spaced snapshot dates, newest first, none later than `now - minAgeDays` (so the outcome window has passed). */
export function snapshotDates(now: Date, count: number, stepDays: number, minAgeDays: number): Date[] {
  return Array.from({ length: count }, (_, i) => new Date(now.getTime() - (minAgeDays + i * stepDays) * DAY_MS));
}
