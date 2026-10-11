import { prisma } from "@/lib/db/prisma";

import { writeMemoryItem } from "./store";
import type { Proposal } from "./rules";

/**
 * Backfill (spec M1) from what already exists, using only what a person or a system record stated: the stored preferred language,
 * the MANUAL asset-class acceptance levels (an automatic level is a guess and is not copied) and active suggestion snoozes.
 * Conversation insights go through the extraction path (propose.ts) and stay UNCONFIRMED. The NBA engine's computed
 * "do not discuss" list is NOT copied: it is recomputed on every refresh, so a copy would only go stale.
 */
export type LegacyInput = {
  clientId: string;
  preferredLanguage: string | null;
  acceptances: { id: string; assetClass: string; level: "HIGH" | "MEDIUM" | "LOW"; isManual: boolean; updatedAt: Date }[];
  dismissals: { id: string; ruleKey: string; dismissedById: string | null; dismissedAt: Date; snoozeUntil: Date }[];
};

const summary = (text: string) => text.slice(0, 280);

export function legacyProposals(input: LegacyInput, now: Date): Proposal[] {
  const out: Proposal[] = [];
  const lang = input.preferredLanguage?.trim();
  if (lang) {
    out.push({ class: "PREFERENCE", key: "preference:language", value: { text: lang }, sourceType: "system", sourceRef: "import:client.preferredLanguage", evidence: [{ sourceRef: "import:client.preferredLanguage", summary: "The preferred language stored on the customer record", observedAt: now }], observedAt: now });
  }
  for (const a of input.acceptances) {
    if (!a.isManual || a.level === "MEDIUM") continue;
    const ref = `import:acceptance:${a.id}`;
    const ev = [{ sourceRef: ref, summary: summary(`Acceptance for ${a.assetClass} set by hand: ${a.level.toLowerCase()}`), observedAt: a.updatedAt }];
    out.push(
      a.level === "LOW"
        ? { class: "PRODUCT_STANCE", key: `product_stance:${a.assetClass}`, value: { assetClass: a.assetClass, stance: "low acceptance" }, sourceType: "system", sourceRef: ref, evidence: ev, observedAt: a.updatedAt }
        : { class: "INTEREST", key: `interest:${a.assetClass}`, value: { assetClass: a.assetClass }, sourceType: "system", sourceRef: ref, evidence: ev, observedAt: a.updatedAt },
    );
  }
  for (const d of input.dismissals) {
    if (d.snoozeUntil.getTime() <= now.getTime()) continue;
    const byPerson = d.dismissedById ? { sourceType: "rm_entry" as const, sourceRef: `user:${d.dismissedById}` } : { sourceType: "system" as const, sourceRef: `import:dismissal:${d.id}` };
    out.push({
      class: "DO_NOT_DO",
      key: `do_not_do:suggestion:${d.ruleKey}`,
      value: { text: `The suggestion "${d.ruleKey.replace(/_/g, " ")}" was dismissed for now` },
      ...byPerson,
      evidence: [{ sourceRef: byPerson.sourceRef, summary: summary(`Suggestion "${d.ruleKey}" snoozed`), observedAt: d.dismissedAt }],
      observedAt: d.dismissedAt,
      freshUntil: d.snoozeUntil,
    });
  }
  return out;
}

/** Writes the backfill for one customer through the normal store (so conflicts become DISPUTED and nothing is overwritten). Safe to re-run. */
export async function backfillMemoryForClient(clientId: string, now: Date = new Date()): Promise<{ proposed: number; created: number; refused: number }> {
  const [client, acceptances, dismissals] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { preferredLanguage: true } }),
    prisma.assetClassAcceptance.findMany({ where: { clientId, isManual: true }, select: { id: true, assetClass: true, level: true, isManual: true, updatedAt: true }, take: 50 }),
    prisma.suggestionDismissal.findMany({ where: { clientId, snoozeUntil: { gt: now } }, select: { id: true, ruleKey: true, dismissedById: true, dismissedAt: true, snoozeUntil: true }, take: 50 }),
  ]);
  if (!client) return { proposed: 0, created: 0, refused: 0 };
  const proposals = legacyProposals({ clientId, preferredLanguage: client.preferredLanguage, acceptances, dismissals }, now);
  let created = 0;
  let refused = 0;
  for (const p of proposals) {
    const person = p.sourceType === "rm_entry" ? { type: "RM" as const, userId: p.sourceRef.slice("user:".length) } : { type: "SYSTEM" as const, userId: null };
    const r = await writeMemoryItem({ ...p, clientId, actor: person, now });
    if (!r.ok) refused++;
    else if (r.outcome === "created") created++;
  }
  return { proposed: proposals.length, created, refused };
}
