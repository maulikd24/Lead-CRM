import type { Role } from "@/generated/prisma/client";

import {
  ATTENTION_LABEL, ATTENTION_VERSION, CAPACITY, CONFIDENCE_FACTOR, DECAY_FLOOR, DECAY_HALF_LIFE_DAYS, IMPORTANCE_FACTOR, KIND_LABEL, OVERRIDE_LABEL, OVERRIDE_RANK, RISK_FACTOR,
  ROLE_KINDS, SNOOZE, UNCONFIRMED_MULTIPLIER, URGENCY_FACTOR, VALUE_FACTOR, WEIGHTS, type AttentionKind, type ConfidenceLevel, type Override, type ValueBand,
} from "./constants";

/**
 * The Attention Engine v1, pure: rank everything a person could do, transparently.
 *
 *   score = 100 x importance x urgency x confidence x value x risk x time-decay      (each factor in (0,1], raised to its weight)
 *
 * It is a HEURISTIC, shown with its inputs and labelled "not a probability". Hard overrides (critical incident, compliance, complaint)
 * outrank any score. The list is role-scoped (default deny), capacity-aware per owner, and honours a person's own dismiss and snooze.
 * Nothing here reads the database or sends anything: sources produce AttentionCandidates, the engine ranks them.
 */

export type { AttentionKind, Override, ValueBand, ConfidenceLevel };
export const ALLOWED_KINDS = ROLE_KINDS;
export const allowedKinds = (role: Role | string): readonly AttentionKind[] => ROLE_KINDS[role] ?? [];

export type Subject = { type: "client" | "system" | "campaign"; id: string | null; label: string };

/** What a source hands the engine. `sourceRef` is stable per underlying record, so dismissals can find the item again. */
export type AttentionCandidate = {
  kind: AttentionKind;
  subKind?: string | null;
  sourceRef: string;
  subject: Subject;
  ownerUserId: string | null;
  title: string;
  detail?: string | null;
  importance: 1 | 2 | 3 | 4 | 5;
  urgency: 1 | 2 | 3 | 4 | 5;
  risk: 1 | 2 | 3 | 4 | 5;
  confidence: ConfidenceLevel;
  /** False for an AI-inferred item no person has confirmed: it can only be down-ranked and prompts a question. */
  confirmed: boolean;
  valueBand: ValueBand;
  occurredAt: Date;
  override: Override;
  href: string;
};

export type FactorLine = { key: "importance" | "urgency" | "confidence" | "value" | "risk" | "decay"; label: string; input: string; value: number; weight: number };
export type Why = {
  label: string;
  version: string;
  formula: string;
  factors: FactorLine[];
  override: { tier: Override; label: string } | null;
};
export type Scored = { score: number; why: Why };

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function scoreCandidate(c: AttentionCandidate, now: Date): Scored {
  const half = DECAY_HALF_LIFE_DAYS[c.kind];
  const ageDays = Math.max(0, (now.getTime() - c.occurredAt.getTime()) / 86_400_000);
  const decay = half === null ? 1 : Math.max(DECAY_FLOOR, Math.pow(0.5, ageDays / half));
  const confidence = CONFIDENCE_FACTOR[c.confidence] * (c.confirmed ? 1 : UNCONFIRMED_MULTIPLIER);
  const factors: FactorLine[] = [
    { key: "importance", label: "Importance", input: `level ${c.importance} of 5`, value: IMPORTANCE_FACTOR[c.importance], weight: WEIGHTS.importance },
    { key: "urgency", label: "Urgency", input: `level ${c.urgency} of 5`, value: URGENCY_FACTOR[c.urgency], weight: WEIGHTS.urgency },
    { key: "confidence", label: "Confidence", input: `${c.confidence}${c.confirmed ? ", confirmed" : ", AI-inferred and unconfirmed"}`, value: confidence, weight: WEIGHTS.confidence },
    { key: "value", label: "Customer value", input: c.valueBand === "unknown" ? "not known" : `${c.valueBand} band`, value: VALUE_FACTOR[c.valueBand], weight: WEIGHTS.value },
    { key: "risk", label: "Risk", input: `level ${c.risk} of 5`, value: RISK_FACTOR[c.risk], weight: WEIGHTS.risk },
    { key: "decay", label: "Time decay", input: half === null ? "none for this kind" : `${Math.round(ageDays)} days old, half-life ${half} days`, value: decay, weight: WEIGHTS.decay },
  ];
  const product = factors.reduce((p, f) => p * Math.pow(f.value, f.weight), 1);
  return {
    score: Math.round(product * 1000) / 10,
    why: {
      label: ATTENTION_LABEL,
      version: ATTENTION_VERSION,
      formula: `100 x ${factors.map((f) => pct(f.value)).join(" x ")}`,
      factors,
      override: c.override === "none" ? null : { tier: c.override, label: `${OVERRIDE_LABEL[c.override]}: outranks the score` },
    },
  };
}

// ---- scope -----------------------------------------------------------------------------------------------------------------
export type Scope = { userId: string; role: Role | string; visibleUserIds: string[] | null };

/** Role first (kind allow-list), then ownership: an RM sees own customers, a manager the team, an admin everything, marketing no customer item at all. */
function inScope(c: AttentionCandidate, scope: Scope): boolean {
  if (!allowedKinds(scope.role).includes(c.kind)) return false;
  if (scope.role === "ADMIN") return true;
  if (scope.role === "MARKETING") return c.kind === "campaign_anomaly";
  if (c.ownerUserId === null) return scope.role === "MANAGER" && c.kind === "approval"; // un-owned items: only the approver view
  return scope.visibleUserIds !== null && scope.visibleUserIds.includes(c.ownerUserId);
}

// ---- dismissals ------------------------------------------------------------------------------------------------------------
export type DismissalRow = { itemKey: string; status: "DISMISSED" | "SNOOZED"; snoozeUntil: Date | null };
export const itemKey = (kind: AttentionKind, sourceRef: string) => `${kind}:${sourceRef}`;

function hidden(key: string, dismissals: readonly DismissalRow[], now: Date): boolean {
  const d = dismissals.find((x) => x.itemKey === key);
  if (!d) return false;
  if (d.status === "DISMISSED") return true;
  return d.snoozeUntil !== null && d.snoozeUntil.getTime() > now.getTime();
}

export function validateDismissal(a: { override: Override; status: "DISMISSED" | "SNOOZED"; snoozeUntil: Date | null; reason: string | null; now: Date }): { ok: true } | { ok: false; error: string } {
  const hard = a.override !== "none";
  if (a.status === "DISMISSED") return hard ? { ok: false, error: "A complaint, compliance or critical item cannot be dismissed. Resolve it, or snooze it for up to 24 hours with a reason." } : { ok: true };
  if (!a.snoozeUntil || Number.isNaN(a.snoozeUntil.getTime())) return { ok: false, error: "Choose when to bring it back." };
  const ms = a.snoozeUntil.getTime() - a.now.getTime();
  if (ms <= 0) return { ok: false, error: "The snooze must end in the future." };
  if (hard) {
    if (ms > SNOOZE.overrideMaxHours * 3_600_000) return { ok: false, error: `This item can be snoozed for ${SNOOZE.overrideMaxHours} hours at most.` };
    if (!a.reason || a.reason.trim().length === 0) return { ok: false, error: "A reason is required to snooze this item." };
    return { ok: true };
  }
  if (ms > SNOOZE.maxDays * 86_400_000) return { ok: false, error: `Snooze for ${SNOOZE.maxDays} days at most.` };
  return { ok: true };
}

// ---- capacity ---------------------------------------------------------------------------------------------------------------
export type Capacity = { openWorkload: number };
export type CapacityReport = { openWorkload: number; nowBudget: number; outsideHours: boolean; overloaded: boolean; deferred: number };

/** Minutes of working time left today for `now` (local time at the configured offset). 0 outside working days and hours. */
export function remainingWorkMinutes(now: Date): number {
  const local = new Date(now.getTime() + CAPACITY.utcOffsetMinutes * 60_000);
  const day = local.getUTCDay();
  if (!(CAPACITY.workDays as readonly number[]).includes(day)) return 0;
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const start = CAPACITY.workStartHour * 60;
  const end = CAPACITY.workEndHour * 60;
  if (minutes >= end) return 0;
  return minutes < start ? end - start : end - minutes;
}

export function nowBudget(openWorkload: number, now: Date): { budget: number; outsideHours: boolean } {
  const remaining = remainingWorkMinutes(now);
  const outsideHours = remaining === 0;
  const base = outsideHours ? CAPACITY.minNow : Math.round((remaining / 60) * CAPACITY.itemsPerHour);
  const reduced = base - Math.floor(Math.max(0, openWorkload) / CAPACITY.workloadStep);
  return { budget: Math.min(CAPACITY.maxNow, Math.max(1, reduced)), outsideHours };
}

// ---- feed ------------------------------------------------------------------------------------------------------------------
export type FeedContext = { now: Date; scope: Scope; dismissals: readonly DismissalRow[]; capacities: Record<string, Capacity> };
export type Lane = "now" | "later";
export type AttentionItem = {
  id: string;
  kind: AttentionKind;
  kindLabel: string;
  subKind: string | null;
  sourceRef: string;
  subject: Subject;
  ownerUserId: string | null;
  title: string;
  detail: string | null;
  score: number;
  override: Override;
  why: Why;
  lane: Lane;
  href: string;
  occurredAt: Date;
};
export type Feed = { items: AttentionItem[]; capacity: Record<string, CapacityReport>; hiddenByDismissal: number; label: string; version: string };

/** Stable order: override tier, then score, then urgency, then the source reference (so the same input always ranks the same way). */
function compare(a: { override: Override; score: number; urgency: number; sourceRef: string }, b: typeof a): number {
  return OVERRIDE_RANK[b.override] - OVERRIDE_RANK[a.override] || b.score - a.score || b.urgency - a.urgency || (a.sourceRef < b.sourceRef ? -1 : a.sourceRef > b.sourceRef ? 1 : 0);
}

export function buildFeed(candidates: readonly AttentionCandidate[], ctx: FeedContext): Feed {
  const scoped = candidates.filter((c) => inScope(c, ctx.scope));
  let hiddenByDismissal = 0;
  const visible = scoped.filter((c) => {
    if (hidden(itemKey(c.kind, c.sourceRef), ctx.dismissals, ctx.now)) {
      hiddenByDismissal += 1;
      return false;
    }
    return true;
  });
  const ranked = visible
    .map((c) => ({ c, s: scoreCandidate(c, ctx.now) }))
    .sort((a, b) => compare({ override: a.c.override, score: a.s.score, urgency: a.c.urgency, sourceRef: a.c.sourceRef }, { override: b.c.override, score: b.s.score, urgency: b.c.urgency, sourceRef: b.c.sourceRef }));

  // Lanes per owner: the first `budget` items of each owner are 'now'. A hard override is always 'now' and never counts as deferred.
  const used = new Map<string, number>();
  const deferred = new Map<string, number>();
  const capacity: Record<string, CapacityReport> = {};
  const owners = new Set(ranked.map((r) => r.c.ownerUserId).filter((o): o is string => o !== null));
  for (const o of owners) {
    const load = ctx.capacities[o]?.openWorkload ?? 0;
    const { budget, outsideHours } = nowBudget(load, ctx.now);
    capacity[o] = { openWorkload: load, nowBudget: budget, outsideHours, overloaded: load >= CAPACITY.overloadAt, deferred: 0 };
  }
  const items: AttentionItem[] = ranked.map(({ c, s }) => {
    let lane: Lane = "now";
    if (c.ownerUserId !== null && c.override === "none") {
      const n = used.get(c.ownerUserId) ?? 0;
      if (n >= capacity[c.ownerUserId].nowBudget) {
        lane = "later";
        deferred.set(c.ownerUserId, (deferred.get(c.ownerUserId) ?? 0) + 1);
      } else used.set(c.ownerUserId, n + 1);
    } else if (c.ownerUserId !== null) used.set(c.ownerUserId, (used.get(c.ownerUserId) ?? 0) + 1);
    return {
      id: itemKey(c.kind, c.sourceRef), kind: c.kind, kindLabel: KIND_LABEL[c.kind], subKind: c.subKind ?? null, sourceRef: c.sourceRef, subject: c.subject, ownerUserId: c.ownerUserId,
      title: c.title, detail: c.detail ?? null, score: s.score, override: c.override, why: s.why, lane, href: c.href, occurredAt: c.occurredAt,
    };
  });
  for (const [o, n] of deferred) capacity[o].deferred = n;
  return { items, capacity, hiddenByDismissal, label: ATTENTION_LABEL, version: ATTENTION_VERSION };
}
