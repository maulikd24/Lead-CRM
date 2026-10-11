import { ageLabel, assessFreshness } from "@/lib/freshness/stale";

import { parseEvidence } from "./evidence";
import { effectOf, independentlySupported, isAiSource, resolvedState, MEMORY_CLASSES, type Evidence, type MemoryClassName, type MemoryConfirmationName } from "./rules";

/** The columns the view needs. A Prisma CustomerMemoryItem satisfies this. Pure: no database, no clock of its own. */
export type MemoryRow = {
  id: string;
  class: string;
  key: string;
  value: unknown;
  sourceType: string;
  sourceRef: string;
  evidence: unknown;
  confidence: string;
  observedAt: Date;
  freshUntil: Date | null;
  lastReconfirmedAt: Date | null;
  confirmation: string;
  confirmedAt: Date | null;
  disputedReason: string | null;
  conflictsWithId: string | null;
  dataClass: string;
  consentBasis: string | null;
  createdAt: Date;
};

export type ViewerCaps = { canManage: boolean; canSeeCalls: boolean };

export const CLASS_LABEL: Record<MemoryClassName, string> = {
  FACT: "Facts",
  PREFERENCE: "Preferences",
  INTEREST: "Interests",
  OBJECTION: "Objections",
  COMMITMENT: "Commitments",
  GOAL: "Goals",
  SENTIMENT: "Recent tone",
  PRODUCT_STANCE: "Product stance",
  SERVICE_CONTEXT: "Service context",
  DO_NOT_DO: "Do not do",
};

const SOURCE_LABEL: Record<string, string> = {
  ledger: "Consent or do-not-contact ledger",
  system: "System record",
  rm_entry: "Entered by an RM",
  document: "From a document",
  conversation_ai: "Read from a conversation by AI",
  call_ai: "Read from a call by AI",
  customer_stated: "Said by the customer, noted by an RM",
  import: "Imported",
};
export const sourceLabel = (s: string): string => SOURCE_LABEL[s] ?? s;

export function describeValue(cls: string, value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return String(value ?? "");
  const v = value as Record<string, unknown>;
  if (typeof v.text === "string" && v.text.trim()) return v.text;
  if (cls === "PRODUCT_STANCE" && typeof v.assetClass === "string") return typeof v.stance === "string" ? `${v.assetClass}: ${v.stance}` : v.assetClass;
  if (typeof v.assetClass === "string") return v.assetClass;
  return Object.entries(v)
    .filter(([, x]) => x !== null && x !== undefined && typeof x !== "object")
    .map(([k, x]) => `${k}: ${String(x)}`)
    .join(", ");
}

export type EvidenceView = { summary: string; label: string; observedAgo: string; href: string | null };

export type MemoryItemView = {
  id: string;
  class: MemoryClassName;
  key: string;
  text: string;
  source: string;
  sourceType: string;
  confidence: "low" | "medium" | "high";
  state: MemoryConfirmationName;
  stateLabel: string;
  stale: boolean;
  ageLine: string;
  observedAt: string;
  freshUntil: string | null;
  conflictNote: string | null;
  sensitive: boolean;
  evidence: EvidenceView[];
  actions: { canConfirm: boolean; canReject: boolean; canDispute: boolean; canEdit: boolean };
};

export type CustomerMemoryView = {
  asOf: Date | null;
  canManage: boolean;
  empty: boolean;
  doNotDo: MemoryItemView[];
  needsConfirmation: MemoryItemView[];
  groups: { class: MemoryClassName; label: string; items: MemoryItemView[] }[];
  counts: { confirmed: number; unconfirmed: number; disputed: number; expired: number; stale: number };
};

const STATE_LABEL: Record<MemoryConfirmationName, string> = {
  CONFIRMED: "Confirmed",
  UNCONFIRMED: "Needs confirmation",
  DISPUTED: "Disputed",
  EXPIRED: "Out of date",
  REJECTED: "Rejected",
  SUPERSEDED: "Replaced",
};

const evidenceHref = (ref: string, caps: ViewerCaps): string | null => {
  const [kind, ...rest] = ref.split(":");
  const id = rest.join(":");
  if (kind === "review" && caps.canSeeCalls) return `/calls/${id}`;
  return null;
};

function ageLine(row: MemoryRow, state: MemoryConfirmationName, now: Date): string {
  const confirmedAt = row.lastReconfirmedAt ?? row.confirmedAt;
  if (state === "UNCONFIRMED") return `Suggested ${ageLabel(row.observedAt, now)}, not yet confirmed`;
  if (state === "DISPUTED") return `Observed ${ageLabel(row.observedAt, now)}, disputed`;
  if (confirmedAt) return `Last confirmed ${ageLabel(confirmedAt, now)}`;
  return `Recorded ${ageLabel(row.observedAt, now)}`;
}

function toView(row: MemoryRow, caps: ViewerCaps, now: Date): MemoryItemView {
  const cls = row.class as MemoryClassName;
  const state = resolvedState({ confirmation: row.confirmation as MemoryConfirmationName, freshUntil: row.freshUntil }, now);
  const live = state === "UNCONFIRMED" || state === "CONFIRMED" || state === "DISPUTED";
  const fresh = assessFreshness({ asOf: row.lastReconfirmedAt ?? row.observedAt, freshUntil: row.freshUntil }, now);
  const m = caps.canManage;
  return {
    id: row.id,
    class: cls,
    key: row.key,
    text: describeValue(cls, row.value),
    source: sourceLabel(row.sourceType),
    sourceType: row.sourceType,
    confidence: row.confidence.toLowerCase() as "low" | "medium" | "high",
    state,
    stateLabel: STATE_LABEL[state],
    stale: state === "EXPIRED" || fresh.status === "stale",
    ageLine: ageLine(row, state, now),
    observedAt: row.observedAt.toISOString(),
    freshUntil: row.freshUntil?.toISOString() ?? null,
    conflictNote: state === "DISPUTED" ? (row.disputedReason ?? "Conflicts with another item for the same thing.") : null,
    sensitive: row.dataClass === "SENSITIVE_PERSONAL",
    evidence: parseEvidence(row.evidence).map((e: Evidence) => ({ summary: e.summary, label: e.sourceRef.split(":")[0], observedAgo: ageLabel(e.observedAt, now), href: evidenceHref(e.sourceRef, caps) })),
    actions: {
      canConfirm: m && cls !== "SENTIMENT" && (state === "UNCONFIRMED" || state === "DISPUTED"),
      canReject: m && live,
      canDispute: m && (state === "UNCONFIRMED" || state === "CONFIRMED"),
      canEdit: m && live && cls !== "SENTIMENT",
    },
  };
}

const ORDER = new Map(MEMORY_CLASSES.map((c, i) => [c, i]));

/**
 * The Customer 360 memory panel's data. Rejected and superseded items are not shown; expired items are, honestly marked as
 * out of date, so nobody mistakes an old answer for a current one. Do-not-do is pinned first, AI proposals that need a person
 * are listed (capped at 5), and an empty customer is reported as empty rather than hidden.
 */
export function buildMemoryView(rows: readonly MemoryRow[], caps: ViewerCaps, now: Date): CustomerMemoryView {
  const shown = rows.filter((r) => r.confirmation !== "REJECTED" && r.confirmation !== "SUPERSEDED");
  const views = shown.map((r) => ({ row: r, view: toView(r, caps, now) }));

  const doNotDo = views.filter((x) => x.view.class === "DO_NOT_DO" && x.view.state !== "EXPIRED").map((x) => x.view);
  const rest = views.filter((x) => !(x.view.class === "DO_NOT_DO" && x.view.state !== "EXPIRED"));

  const byClass = new Map<MemoryClassName, MemoryItemView[]>();
  for (const { view } of rest) byClass.set(view.class, [...(byClass.get(view.class) ?? []), view]);
  const stateRank = (s: MemoryConfirmationName) => ({ CONFIRMED: 0, DISPUTED: 1, UNCONFIRMED: 2, EXPIRED: 3, REJECTED: 4, SUPERSEDED: 5 })[s];
  const groups = [...byClass.entries()]
    .sort(([a], [b]) => (ORDER.get(a) ?? 99) - (ORDER.get(b) ?? 99))
    .map(([cls, items]) => ({ class: cls, label: CLASS_LABEL[cls], items: [...items].sort((a, b) => stateRank(a.state) - stateRank(b.state) || b.observedAt.localeCompare(a.observedAt)) }));

  const needsConfirmation = views
    .filter((x) => x.view.state === "UNCONFIRMED" && isAiSource(x.row.sourceType) && x.view.class !== "SENTIMENT")
    .sort((a, b) => b.row.createdAt.getTime() - a.row.createdAt.getTime())
    .slice(0, 5)
    .map((x) => x.view);

  const count = (s: MemoryConfirmationName) => views.filter((x) => x.view.state === s).length;
  const asOf = shown.reduce<Date | null>((max, r) => (!max || r.observedAt > max ? r.observedAt : max), null);
  return {
    asOf,
    canManage: caps.canManage,
    empty: shown.length === 0,
    doNotDo,
    needsConfirmation,
    groups,
    counts: { confirmed: count("CONFIRMED"), unconfirmed: count("UNCONFIRMED"), disputed: count("DISPUTED"), expired: count("EXPIRED"), stale: views.filter((x) => x.view.stale).length },
  };
}

// ---- the read API for other modules ----------------------------------------------------------------------------------------------------------
export type DecisionMemoryItem = { id: string; class: MemoryClassName; key: string; value: unknown; confidence: string; observedAt: Date; freshUntil: Date | null };
export type DecisionMemory = {
  /** When this read was taken. */
  asOf: Date;
  /** CONFIRMED and fresh (and any do-not-do, even disputed): may block or drive an action. */
  authoritative: DecisionMemoryItem[];
  /** UNCONFIRMED and fresh: may only downrank, add a "check with the customer" hint or become a question for a person. Never a send, never stated as fact. */
  advisory: DecisionMemoryItem[];
  /** DISPUTED (not do-not-do): evidence conflicts; a decision should abstain on this key or ask. */
  contested: DecisionMemoryItem[];
  doNotDo: DecisionMemoryItem[];
};

const toDecision = (r: MemoryRow): DecisionMemoryItem => ({ id: r.id, class: r.class as MemoryClassName, key: r.key, value: r.value, confidence: r.confidence, observedAt: r.observedAt, freshUntil: r.freshUntil });

/** Pure core of getMemoryForDecisions. Carries no evidence, no source text and no raw conversation. */
export function buildDecisionMemory(rows: readonly MemoryRow[], now: Date): DecisionMemory {
  const out: DecisionMemory = { asOf: now, authoritative: [], advisory: [], contested: [], doNotDo: [] };
  for (const r of rows) {
    const eff = effectOf({ class: r.class as MemoryClassName, confirmation: r.confirmation as MemoryConfirmationName, freshUntil: r.freshUntil }, now);
    const item = toDecision(r);
    if (eff === "authoritative") out.authoritative.push(item);
    else if (eff === "advisory") out.advisory.push(item);
    else if (resolvedState({ confirmation: r.confirmation as MemoryConfirmationName, freshUntil: r.freshUntil }, now) === "DISPUTED") out.contested.push(item);
    if (r.class === "DO_NOT_DO" && eff === "authoritative") out.doNotDo.push(item);
  }
  return out;
}

/**
 * R6, read side: items derived under a consent purpose the customer has since withdrawn are excluded. A confirmed item stays only
 * when independently supported. This holds even if the expiry sweep has not run yet, so a withdrawal takes effect at once.
 */
export function excludeWithdrawn<T extends Pick<MemoryRow, "consentBasis" | "confirmation" | "sourceType" | "evidence">>(rows: readonly T[], deniedPurposes: ReadonlySet<string>): T[] {
  if (deniedPurposes.size === 0) return [...rows];
  return rows.filter((r) => {
    if (!r.consentBasis || !deniedPurposes.has(r.consentBasis)) return true;
    return r.confirmation === "CONFIRMED" && independentlySupported({ sourceType: r.sourceType, evidence: parseEvidence(r.evidence) });
  });
}
