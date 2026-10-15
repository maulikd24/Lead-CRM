import { SALES_BLOCK, type DraftContext, type DraftKind, type DraftLanguage } from "./draft";

/**
 * Builds the drafter's plain context from the read-only agent briefing (intelligence/agent.ts, buildAgentBriefing persist:false).
 * Only the fields a draft needs are copied across. Pure: the caller passes the briefing in.
 */
export type BriefingLike = {
  customer: { id: string; name: string; preferredLanguage: string | null };
  whyContactingNow: { programme: string };
  /** Display text only (shown in the RM screens). Never matched against drafts. */
  mustNotDiscuss: string[];
  /** Structured keys ("asset:PMS", "sales") the drafter enforces. Missing keys with display text present fail closed. */
  mustNotDiscussKeys: string[];
  assetClassAcceptance: Record<string, { level: string }>;
  recentInteractions: { channel: string; date: string }[];
  pendingCommitments: { text: string; due: string | null }[];
  openIssues: { kind: string }[];
};

/** A first name only: the first word, letters and apostrophes, capped. "there" when nothing usable is left. */
export function firstNameOf(fullName: string): string {
  const first = (fullName.trim().split(/\s+/)[0] ?? "").replace(/[^\p{L}']/gu, "").slice(0, 20);
  return first || "there";
}

export function languageOf(preferred: string | null): DraftLanguage {
  // Hindi and Hinglish customers get the roman-script Hinglish wording; English is the default.
  return (preferred ?? "").toLowerCase().startsWith("hi") ? "Hinglish" : "English";
}

/**
 * Splits the structured blocked keys into asset classes and other topics. A key with no usable form is kept, so the draft check
 * fails closed on it instead of silently passing.
 */
export function splitBlockedKeys(keys: string[]): { blockedAssetClasses: string[]; blockedTopics: string[] } {
  const blockedAssetClasses: string[] = [];
  const blockedTopics: string[] = [];
  for (const raw of keys) {
    const key = raw.trim();
    if (key.startsWith("asset:")) blockedAssetClasses.push(key.slice("asset:".length).trim());
    else if (key === SALES_BLOCK) blockedTopics.push(SALES_BLOCK);
    else blockedTopics.push(key.replace(/^topic:/, "").trim());
  }
  return { blockedAssetClasses, blockedTopics };
}

export function draftContextFromBriefing(b: BriefingLike, kind: DraftKind): DraftContext {
  const last = b.recentInteractions[0] ?? null;
  const keys = b.mustNotDiscussKeys ?? [];
  const split = splitBlockedKeys(keys);
  // Display text with no structured keys: the blocks cannot be enforced, so the empty entry makes every draft fail closed.
  if (b.mustNotDiscuss.length > 0 && keys.length === 0) split.blockedTopics.push("");
  return {
    clientId: b.customer.id,
    firstName: firstNameOf(b.customer.name),
    language: languageOf(b.customer.preferredLanguage),
    kind,
    acceptance: Object.entries(b.assetClassAcceptance).map(([asset, a]) => `${asset}: ${a.level}`),
    lastInteraction: last ? { channel: last.channel, date: last.date } : null,
    pendingCommitments: b.pendingCommitments.length,
    blockedAssetClasses: split.blockedAssetClasses,
    blockedTopics: split.blockedTopics,
    openIssueKinds: b.openIssues.map((i) => i.kind),
  };
}
