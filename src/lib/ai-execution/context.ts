import type { DraftContext, DraftKind, DraftLanguage } from "./draft";

/**
 * Builds the drafter's plain context from the read-only agent briefing (intelligence/agent.ts, buildAgentBriefing persist:false).
 * Only the fields a draft needs are copied across. Pure: the caller passes the briefing in.
 */
export type BriefingLike = {
  customer: { id: string; name: string; preferredLanguage: string | null };
  whyContactingNow: { programme: string };
  mustNotDiscuss: string[];
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

export function draftContextFromBriefing(b: BriefingLike, kind: DraftKind): DraftContext {
  const last = b.recentInteractions[0] ?? null;
  return {
    clientId: b.customer.id,
    firstName: firstNameOf(b.customer.name),
    language: languageOf(b.customer.preferredLanguage),
    kind,
    acceptance: Object.entries(b.assetClassAcceptance).map(([asset, a]) => `${asset}: ${a.level}`),
    lastInteraction: last ? { channel: last.channel, date: last.date } : null,
    pendingCommitments: b.pendingCommitments.length,
    doNotDiscuss: b.mustNotDiscuss,
    openIssueKinds: b.openIssues.map((i) => i.kind),
  };
}
