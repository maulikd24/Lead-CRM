/**
 * Customer memory rules, pure (docs/customer-memory.md, CUSTOMER_MEMORY_SPEC rules R1 to R8 plus the Wave 2 DISPUTED state).
 * No database, no clock of its own: every function takes `now`. The store (store.ts) applies these plans inside a transaction.
 *
 * The invariants this file owns, each with a test and a deliberate-break check:
 *  - an AI-derived item is born UNCONFIRMED and has no way to become CONFIRMED except a human action (R1);
 *  - no evidence, no item (R2); no AI or human record of health, religion, caste, orientation or politics (R5);
 *  - a new item that disagrees with a live one is stored DISPUTED next to it and never changes it (R8, Wave 2);
 *  - a rejected item is not re-derived by AI for 90 days (R7);
 *  - what an item may influence depends on its state (R3): CONFIRMED can drive or block, UNCONFIRMED may only downrank,
 *    hint or prompt a question, DISPUTED influences nothing (except a do-not-do, which keeps blocking: when in doubt, do not).
 */

export const MEMORY_CLASSES = ["FACT", "PREFERENCE", "INTEREST", "OBJECTION", "COMMITMENT", "GOAL", "SENTIMENT", "PRODUCT_STANCE", "SERVICE_CONTEXT", "DO_NOT_DO"] as const;
export type MemoryClassName = (typeof MEMORY_CLASSES)[number];
export const MEMORY_CONFIRMATIONS = ["UNCONFIRMED", "CONFIRMED", "DISPUTED", "REJECTED", "EXPIRED", "SUPERSEDED"] as const;
export type MemoryConfirmationName = (typeof MEMORY_CONFIRMATIONS)[number];
export const MEMORY_CONFIDENCES = ["LOW", "MEDIUM", "HIGH"] as const;
export type MemoryConfidenceName = (typeof MEMORY_CONFIDENCES)[number];

export const SOURCE_TYPES = ["ledger", "system", "rm_entry", "document", "conversation_ai", "call_ai", "customer_stated", "import"] as const;
export type MemorySourceType = (typeof SOURCE_TYPES)[number];

export const AI_SOURCES: readonly MemorySourceType[] = ["conversation_ai", "call_ai"];
export const isAiSource = (s: string): boolean => (AI_SOURCES as readonly string[]).includes(s);

/** The consent purpose an item derived from this source needs at derivation time (R6). Human and system sources need none. */
export function consentPurposeFor(sourceType: MemorySourceType): "AI_PROCESSING_OF_CHATS" | "CALL_RECORDING" | null {
  if (sourceType === "conversation_ai") return "AI_PROCESSING_OF_CHATS";
  if (sourceType === "call_ai") return "CALL_RECORDING";
  return null;
}

export type Evidence = { sourceRef: string; summary: string; observedAt: Date };

export type Proposal = {
  class: MemoryClassName;
  key: string;
  value: unknown;
  sourceType: MemorySourceType;
  sourceRef: string;
  evidence: Evidence[];
  observedAt: Date;
  /** COMMITMENT: when it was promised for. */
  dueAt?: Date | null;
  /** An explicit expiry (an RM extending a product stance, for example). */
  freshUntil?: Date | null;
  /** True when the quote behind an AI proposal was checked against its source text. */
  quoteVerified?: boolean;
};

export type ExistingItem = {
  id: string;
  class: MemoryClassName;
  key: string;
  value: unknown;
  sourceType: string;
  sourceRef: string;
  evidence: Evidence[] | unknown;
  confidence: MemoryConfidenceName;
  observedAt: Date;
  freshUntil: Date | null;
  confirmation: MemoryConfirmationName;
  dataClass: string;
  consentBasis: string | null;
  createdAt: Date;
  rejectedAt: Date | null;
  supersededById: string | null;
  conflictsWithId: string | null;
};

const DAY = 86_400_000;
const REJECTION_SUPPRESSION_DAYS = 90;
const MAX_EVIDENCE_SUMMARY = 300;

/** R4: default freshness windows (days). null = no default expiry (a goal lives with its goal, a do-not-do until removed). */
export const CLASS_FRESHNESS_DAYS: Record<MemoryClassName, number | null> = {
  FACT: 365,
  PREFERENCE: 180,
  INTEREST: 60,
  OBJECTION: 60,
  COMMITMENT: null, // until it is due
  GOAL: null,
  SENTIMENT: 30,
  PRODUCT_STANCE: 30, // matches nba.ts; an RM can extend
  SERVICE_CONTEXT: null, // until resolved plus 14 days, set by the service layer
  DO_NOT_DO: null,
};

// ---- R5: sensitive topics ---------------------------------------------------------------------------------------------
const SENSITIVE: { topic: string; re: RegExp }[] = [
  { topic: "health", re: /\b(diabet\w*|cancer|tumou?r|hiv|aids|illness|disease|surgery|chemo\w*|dialysis|heart attack|medical condition|depress\w*|anxiety|mental health|pregnan\w*|disabilit\w*|disabled)\b/i },
  { topic: "religion", re: /\b(hindu\w*|muslim\w*|christian\w*|sikh\w*|buddhis\w*|jewish|jain(ism)?|parsi|islam\w*|religio\w*)\b/i },
  { topic: "caste", re: /\b(caste\w*|dalit\w*|brahmin\w*|scheduled tribe|obc)\b/i },
  { topic: "orientation", re: /\b(gay|lesbian|bisexual|transgender|lgbt\w*|homosexual\w*|sexual orientation)\b/i },
  { topic: "politics", re: /\b(politic\w*|vote[sd]?|voting|bjp|election\w*)\b/i },
  { topic: "vulnerability", re: /\b(vulnerab\w+)\b/i },
];

/** Topics found in the proposal's key, value and evidence summaries. */
export function sensitiveTopics(p: Pick<Proposal, "key" | "value" | "evidence">): string[] {
  const text = [p.key, JSON.stringify(p.value ?? ""), ...p.evidence.map((e) => e.summary)].join(" \n ");
  return SENSITIVE.filter((s) => s.re.test(text)).map((s) => s.topic);
}

// ---- validation ---------------------------------------------------------------------------------------------------------
export type ValidationCode = "NO_EVIDENCE" | "NO_SOURCE_REF" | "BAD_KEY" | "SENSITIVE_TOPIC" | "EVIDENCE_TOO_LONG";
export type Validation = { ok: true } | { ok: false; code: ValidationCode; message: string };

const SOURCE_REF = /^(insight|review|activity|consent|ticket|task|document|goal|user|import|message|complaint|commitment):[^\s]{1,100}$/;
export const isSourceRef = (v: string): boolean => SOURCE_REF.test(v);

const fail = (code: ValidationCode, message: string): Validation => ({ ok: false, code, message });

export function validateProposal(p: Proposal): Validation {
  if (!p.sourceRef || !isSourceRef(p.sourceRef)) return fail("NO_SOURCE_REF", "An item needs a source it can be traced back to.");
  if (!Array.isArray(p.evidence) || p.evidence.length === 0) return fail("NO_EVIDENCE", "No evidence, no item.");
  for (const e of p.evidence) {
    if (!e || !e.sourceRef || !isSourceRef(e.sourceRef) || !e.summary || !e.summary.trim()) return fail("NO_EVIDENCE", "Every piece of evidence needs a source and a short summary.");
    if (e.summary.length > MAX_EVIDENCE_SUMMARY) return fail("EVIDENCE_TOO_LONG", "Evidence is a short redacted summary, not the original text.");
  }
  if (!p.key.startsWith(`${p.class.toLowerCase()}:`) || p.key.length < p.class.length + 2 || p.key.length > 120) return fail("BAD_KEY", `The key must start with "${p.class.toLowerCase()}:".`);
  const topics = sensitiveTopics(p);
  if (topics.length) {
    // The one exception: an RM may flag a vulnerability. Nothing else sensitive is recorded, from anyone.
    const onlyVulnerabilityFromRm = topics.every((t) => t === "vulnerability") && p.sourceType === "rm_entry";
    if (!onlyVulnerabilityFromRm) return fail("SENSITIVE_TOPIC", `Memory does not record ${topics.join(", ")}.`);
  }
  return { ok: true };
}

// ---- born state, confidence, defaults ------------------------------------------------------------------------------------
/** R1. Only a human or a system of record can start an item CONFIRMED, and sentiment is never confirmed. */
export function initialConfirmation(sourceType: MemorySourceType, cls: MemoryClassName, opts: { humanAsserted?: boolean } = {}): "UNCONFIRMED" | "CONFIRMED" {
  if (isAiSource(sourceType)) return "UNCONFIRMED";
  if (cls === "SENTIMENT") return "UNCONFIRMED";
  if (sourceType === "import") return opts.humanAsserted ? "CONFIRMED" : "UNCONFIRMED";
  return "CONFIRMED";
}

const distinctSources = (evidence: readonly Evidence[]) => new Set(evidence.map((e) => e.sourceRef)).size;

/** Spec section 5. A rule, in code, with tests; never a number shown to a user. */
export function deriveConfidence(input: { sourceType: MemorySourceType; evidence: readonly Evidence[]; quoteVerified: boolean }): MemoryConfidenceName {
  const { sourceType, evidence, quoteVerified } = input;
  if (isAiSource(sourceType)) return distinctSources(evidence) >= 2 || quoteVerified ? "MEDIUM" : "LOW"; // never HIGH: R1
  if (sourceType === "customer_stated") return "MEDIUM";
  if (sourceType === "import") return "LOW";
  return "HIGH"; // ledger, system, rm_entry, document
}

export type ItemDefaults = {
  confirmation: "UNCONFIRMED" | "CONFIRMED";
  confidence: MemoryConfidenceName;
  freshUntil: Date | null;
  dataClass: "PERSONAL" | "SENSITIVE_PERSONAL";
  consentBasis: string | null;
};

export function buildItemDefaults(p: Proposal, _now: Date): ItemDefaults {
  void _now;
  const confirmation = initialConfirmation(p.sourceType, p.class);
  let confidence = deriveConfidence({ sourceType: p.sourceType, evidence: p.evidence, quoteVerified: !!p.quoteVerified });
  if (p.class === "SENTIMENT") confidence = "LOW";
  if (isAiSource(p.sourceType) && confidence === "HIGH") confidence = "MEDIUM"; // belt and braces for R1

  let freshUntil: Date | null;
  if (p.freshUntil) freshUntil = p.freshUntil;
  else if (p.class === "COMMITMENT") freshUntil = p.dueAt ?? new Date(p.observedAt.getTime() + 30 * DAY);
  else {
    const days = CLASS_FRESHNESS_DAYS[p.class];
    freshUntil = days == null ? null : new Date(p.observedAt.getTime() + days * DAY);
  }

  const sensitiveClass = p.class === "GOAL" || p.class === "SENTIMENT" || p.class === "FACT";
  const dataClass = sensitiveClass || sensitiveTopics(p).length > 0 ? "SENSITIVE_PERSONAL" : "PERSONAL";
  return { confirmation, confidence, freshUntil, dataClass, consentBasis: consentPurposeFor(p.sourceType) };
}

// ---- state resolution ----------------------------------------------------------------------------------------------------
/** The state as of `now`: a live item past its freshUntil reads as EXPIRED, whatever is stored. */
export function resolvedState(item: Pick<ExistingItem, "confirmation" | "freshUntil">, now: Date): MemoryConfirmationName {
  const live = item.confirmation === "UNCONFIRMED" || item.confirmation === "CONFIRMED" || item.confirmation === "DISPUTED";
  if (live && item.freshUntil && item.freshUntil.getTime() <= now.getTime()) return "EXPIRED";
  return item.confirmation;
}

export type Effect = "authoritative" | "advisory" | "none";

/**
 * R3. What a consumer (decision engine, agents, attention) may do with the item.
 * authoritative: may block or drive an action. advisory: may downrank, add a "check with the customer" hint or generate a
 * question for a human; never triggers anything and is never stated to the customer as fact. none: ignore it.
 */
export function effectOf(item: Pick<ExistingItem, "class" | "confirmation" | "freshUntil">, now: Date): Effect {
  const state = resolvedState(item, now);
  if (state === "CONFIRMED") return "authoritative";
  if (state === "UNCONFIRMED") return "advisory";
  if (state === "DISPUTED") return item.class === "DO_NOT_DO" ? "authoritative" : "none"; // when in doubt, do not
  return "none";
}

// ---- value comparison -----------------------------------------------------------------------------------------------------
function canon(v: unknown): unknown {
  if (typeof v === "string") return v.trim().toLowerCase();
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, canon(x)]),
    );
  }
  return v;
}
export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// ---- write planning --------------------------------------------------------------------------------------------------------
export type WritePlan =
  | { kind: "suppress"; reason: "REJECTED_RECENTLY" }
  | { kind: "reaffirm"; itemId: string }
  | { kind: "create"; confirmation: "UNCONFIRMED" | "CONFIRMED" | "DISPUTED"; conflictsWithId: string | null; disputeExistingIds: string[] };

const LIVE = new Set<MemoryConfirmationName>(["UNCONFIRMED", "CONFIRMED", "DISPUTED"]);

/**
 * Decides what writing `incoming` does to what is already stored for this customer. It never asks to change an existing item's
 * value: a disagreement is stored as a new DISPUTED item beside the old one (R8 with the Wave 2 DISPUTED state), and only a
 * person resolves it. An AI writer cannot dispute a CONFIRMED item (a guess must not pause a human's fact); a human writer
 * disputes every live item it disagrees with.
 */
export function planWrite(incoming: Proposal, existing: readonly ExistingItem[], now: Date): WritePlan {
  const sameKey = existing.filter((e) => e.key === incoming.key);

  // R7: the AI does not re-create what a person rejected in the last 90 days.
  if (isAiSource(incoming.sourceType)) {
    const cutoff = now.getTime() - REJECTION_SUPPRESSION_DAYS * DAY;
    const blocked = sameKey.some((e) => e.confirmation === "REJECTED" && e.rejectedAt && e.rejectedAt.getTime() > cutoff && sameValue(e.value, incoming.value));
    if (blocked) return { kind: "suppress", reason: "REJECTED_RECENTLY" };
  }

  const live = sameKey.filter((e) => LIVE.has(resolvedState(e, now)));
  const same = live.find((e) => sameValue(e.value, incoming.value) && e.confirmation === "CONFIRMED") ?? live.find((e) => sameValue(e.value, incoming.value));
  if (same) return { kind: "reaffirm", itemId: same.id };

  const conflicts = live.filter((e) => !sameValue(e.value, incoming.value));
  if (conflicts.length === 0) return { kind: "create", confirmation: initialConfirmation(incoming.sourceType, incoming.class), conflictsWithId: null, disputeExistingIds: [] };

  const rank = (e: ExistingItem) => (e.confirmation === "CONFIRMED" ? 2 : e.confirmation === "DISPUTED" ? 0 : 1);
  const anchor = [...conflicts].sort((a, b) => rank(b) - rank(a) || b.createdAt.getTime() - a.createdAt.getTime())[0];
  const ai = isAiSource(incoming.sourceType);
  const disputeExistingIds = conflicts.filter((e) => e.confirmation === "UNCONFIRMED" || (!ai && e.confirmation === "CONFIRMED")).map((e) => e.id);
  return { kind: "create", confirmation: "DISPUTED", conflictsWithId: anchor.id, disputeExistingIds };
}

// ---- human actions ------------------------------------------------------------------------------------------------------------
export type MemoryAction =
  | { type: "confirm"; actorId: string }
  | { type: "reject"; actorId: string; reason: string }
  | { type: "dispute"; actorId: string; reason: string }
  | { type: "reconfirm"; actorId: string };

export type TransitionCode = "ACTOR_REQUIRED" | "BAD_STATE" | "NOT_CONFIRMABLE" | "REASON_REQUIRED";
export type TransitionResult = { ok: true; patch: Record<string, unknown> } | { ok: false; code: TransitionCode; message: string };

const no = (code: TransitionCode, message: string): TransitionResult => ({ ok: false, code, message });
const isPerson = (id: string) => !!id && id.trim() !== "" && id !== "system";

export function transition(item: ExistingItem, action: MemoryAction, now: Date): TransitionResult {
  if (!isPerson(action.actorId)) return no("ACTOR_REQUIRED", "A named person must do this.");
  const state = resolvedState(item, now);

  switch (action.type) {
    case "confirm": {
      if (item.class === "SENTIMENT") return no("NOT_CONFIRMABLE", "Sentiment is derived and is never confirmed.");
      if (state !== "UNCONFIRMED" && state !== "DISPUTED") return no("BAD_STATE", `A ${state.toLowerCase()} item cannot be confirmed.`);
      return { ok: true, patch: { confirmation: "CONFIRMED", confirmedById: action.actorId, confirmedAt: now, lastReconfirmedAt: now, confidence: "HIGH", conflictsWithId: null } };
    }
    case "reject": {
      if (state !== "UNCONFIRMED" && state !== "CONFIRMED" && state !== "DISPUTED") return no("BAD_STATE", `A ${state.toLowerCase()} item cannot be rejected.`);
      if (!action.reason?.trim()) return no("REASON_REQUIRED", "Say why.");
      return { ok: true, patch: { confirmation: "REJECTED", rejectedById: action.actorId, rejectedAt: now, rejectedReason: action.reason.trim() } };
    }
    case "dispute": {
      if (state !== "UNCONFIRMED" && state !== "CONFIRMED") return no("BAD_STATE", `A ${state.toLowerCase()} item cannot be disputed.`);
      if (!action.reason?.trim()) return no("REASON_REQUIRED", "Say why.");
      return { ok: true, patch: { confirmation: "DISPUTED", disputedById: action.actorId, disputedAt: now, disputedReason: action.reason.trim() } };
    }
    case "reconfirm": {
      if (state !== "CONFIRMED") return no("BAD_STATE", "Only a confirmed item can be reconfirmed.");
      const days = CLASS_FRESHNESS_DAYS[item.class];
      return { ok: true, patch: { lastReconfirmedAt: now, ...(days == null ? {} : { freshUntil: new Date(now.getTime() + days * DAY) }) } };
    }
  }
}
