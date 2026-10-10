import { accrualStates, type LedgerEntry } from "./ledger";
import { monthKeyIST } from "./rewards";
import type { NewLedgerEntry } from "./store";

/**
 * Clawback detection. A reward carries the end of its clawback window, fixed when it accrued from its rule. If the
 * referred person's qualifying event is later reversed (KYC no longer approved, funding no longer in place) and the
 * reversal happened inside that window, a CLAWBACK entry is appended: negative, pointing at the reward, flagged for a
 * person to confirm or waive. Judged by WHEN the reversal happened, not when the job noticed it. Idempotent: one
 * clawback per reward, ever (a waived one is not raised again).
 */
export type ReversalEvidence = { kycReversedAt?: Date | null; fundingReversedAt?: Date | null };

export const CLAWBACK_FLAGS = ["CLAWBACK_KYC_REVOKED", "CLAWBACK_FUNDING_REVERSED"] as const;
export type ClawbackFlag = (typeof CLAWBACK_FLAGS)[number];

/** The date in India time, as the screens show it. */
const day = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export function planClawbacks(i: { ledger: LedgerEntry[]; referralId: string; evidence: ReversalEvidence; now: Date }): NewLedgerEntry[] {
  const states = accrualStates(i.ledger);
  const alreadyRaised = new Set(i.ledger.filter((e) => e.kind === "CLAWBACK" && e.refEntryId).map((e) => e.refEntryId as string));
  const out: NewLedgerEntry[] = [];
  for (const a of i.ledger) {
    if (a.kind !== "ACCRUED" || a.referralId !== i.referralId || a.amountPaise <= 0 || !a.clawbackUntil) continue;
    if (alreadyRaised.has(a.id) || states.get(a.id) === "REVERSED") continue;
    const reversedAt = a.eventType === "KYC_COMPLETE" ? i.evidence.kycReversedAt : a.eventType === "FIRST_FUNDING" ? i.evidence.fundingReversedAt : null;
    if (!reversedAt || reversedAt.getTime() > a.clawbackUntil.getTime()) continue;
    const flag: ClawbackFlag = a.eventType === "KYC_COMPLETE" ? "CLAWBACK_KYC_REVOKED" : "CLAWBACK_FUNDING_REVERSED";
    out.push({
      idempotencyKey: `clawback:${a.id}`,
      kind: "CLAWBACK",
      referrerId: a.referrerId,
      referralId: a.referralId ?? null,
      eventType: a.eventType === "KYC_COMPLETE" || a.eventType === "FIRST_FUNDING" ? a.eventType : null,
      ruleId: a.ruleId ?? null,
      refEntryId: a.id,
      statementId: null,
      amountPaise: -a.amountPaise,
      periodMonth: monthKeyIST(i.now),
      flags: [flag],
      note: `${a.eventType === "KYC_COMPLETE" ? "KYC was revoked" : "The funding was reversed"} on ${day(reversedAt)}, inside the window that ended ${day(a.clawbackUntil)}.`,
      actorId: null,
    });
  }
  return out;
}
