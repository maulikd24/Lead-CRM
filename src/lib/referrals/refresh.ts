import { planClawbacks } from "./clawback";
import { DEFAULT_VELOCITY_LIMIT, fraudFlags } from "./fraud";
import { netAccruedInMonth, type LedgerEntry } from "./ledger";
import { computeReward, monthKeyIST, ruleApplies } from "./rewards";
import { currentStage, deriveEvents } from "./state-machine";
import type { NewLedgerEntry, ReferralStore } from "./store";

export type RefreshResult = { referralsChecked: number; eventsRecorded: number; entriesAccrued: number; needingReview: number; clawbacks: number; failed: number };

const MAX_PER_RUN = 2000;
/** A reversal that happened inside a window is still caught for this long after the window closes (a job that was down). */
export const CLAWBACK_GRACE_DAYS = 7;
const DAY = 86_400_000;

export const accrualKey = (referralId: string, type: string, ruleId: string) => `accrue:${referralId}:${type}:${ruleId}`;

/**
 * Brings every attributed referral up to date: records the KYC and funding events the CRM's own data now shows, then
 * accrues rewards for every active rule that applies to an event, once (idempotency keys). With no rules configured the
 * events are still recorded and nothing accrues. Abuse flags and the monthly cap are applied here; a flagged reward is
 * written anyway and waits in Needs review.
 */
export async function refreshProgress(i: { store: ReferralStore; now: Date }): Promise<RefreshResult> {
  const { store } = i;
  const result: RefreshResult = { referralsChecked: 0, eventsRecorded: 0, entriesAccrued: 0, needingReview: 0, clawbacks: 0, failed: 0 };
  const rules = (await store.listRules()).filter((r) => r.active);
  const velocityRaw = Number(await store.getSetting("velocity_limit"));
  const velocityLimit = Number.isInteger(velocityRaw) && velocityRaw > 0 ? velocityRaw : DEFAULT_VELOCITY_LIMIT;
  const monthCache = new Map<string, LedgerEntry[]>();
  const monthEntries = async (referrerId: string, month: string) => {
    const k = `${referrerId}|${month}`;
    if (!monthCache.has(k)) monthCache.set(k, await store.ledgerForReferrerMonth(referrerId, month));
    return monthCache.get(k)!;
  };

  const watching = await store.referralsWithOpenClawback(new Date(i.now.getTime() - CLAWBACK_GRACE_DAYS * DAY));
  const ledgerCache = new Map<string, Awaited<ReturnType<ReferralStore["ledgerForReferrer"]>>>();
  const referrerLedger = async (referrerId: string) => {
    if (!ledgerCache.has(referrerId)) ledgerCache.set(referrerId, await store.ledgerForReferrer(referrerId));
    return ledgerCache.get(referrerId)!;
  };

  for (const referral of await store.listAttributed(MAX_PER_RUN)) {
    result.referralsChecked++;
    try {
      await refreshOne(referral);
    } catch (error) {
      // One referral that cannot be saved must not hold up the rest. Nothing of it was written (the commit is one
      // transaction), the cached month totals are dropped so a half-built accrual cannot count towards a cap, and the
      // next run does it again from the same data. The log carries the error class only.
      result.failed++;
      monthCache.clear();
      ledgerCache.clear();
      console.error("Referral refresh failed for one referral", error instanceof Error ? error.name : "unknown");
    }
  }
  return result;

  async function refreshOne(referral: Awaited<ReturnType<ReferralStore["listAttributed"]>>[number]) {
    const state = await store.loadProgress(referral);
    const recorded = new Set<string>(state.events.map((e) => e.type));
    if (currentStage(recorded) === "FIRST_FUNDING" && rules.length === 0 && !watching.has(referral.id)) return;

    const fresh = deriveEvents(state.evidence, recorded);
    const all = [...state.events.map((e) => ({ type: e.type, occurredAt: e.occurredAt, amountPaise: e.amountPaise })), ...fresh].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const done = rules.length ? await store.accrualKeys(referral.id) : new Set<string>();
    const entries: NewLedgerEntry[] = [];

    for (const event of all) {
      for (const rule of rules) {
        const key = accrualKey(referral.id, event.type, rule.id);
        if (!ruleApplies(rule, event) || done.has(key)) continue;
        const month = monthKeyIST(event.occurredAt);
        const ledger = await monthEntries(referral.referrerId, month);
        const reward = computeReward(rule, { eventAmountPaise: event.amountPaise ?? 0, accruedThisMonthPaise: netAccruedInMonth(ledger, referral.referrerId, month) });
        if (reward.amountPaise <= 0) continue;
        const flags = fraudFlags({ referrer: state.referrer, referred: state.referred, siblings: state.siblings, attributionsLast24h: state.attributionsLast24h, velocityLimit, capped: reward.capped, devices: state.devices, referralFlags: state.referralFlags });
        entries.push({ idempotencyKey: key, kind: "ACCRUED", referrerId: referral.referrerId, referralId: referral.id, eventType: event.type, ruleId: rule.id, refEntryId: null, statementId: null, amountPaise: reward.amountPaise, periodMonth: month, flags, note: null, actorId: null, clawbackUntil: rule.clawbackDays ? new Date(event.occurredAt.getTime() + rule.clawbackDays * DAY) : null });
        ledger.push({ id: key, kind: "ACCRUED", referrerId: referral.referrerId, amountPaise: reward.amountPaise, refEntryId: null, flags, periodMonth: month });
      }
    }
    // Rewards whose qualifying event has since been reversed (KYC revoked, funding reversed) inside their window are taken back.
    const clawbacks = state.evidence.kycReversedAt || state.evidence.fundingReversedAt ? planClawbacks({ ledger: await referrerLedger(referral.referrerId), referralId: referral.id, evidence: state.evidence, now: i.now }) : [];
    entries.push(...clawbacks);

    if (fresh.length || entries.length) {
      await store.commitProgress({ referralId: referral.id, events: fresh, entries });
      result.eventsRecorded += fresh.length;
      result.entriesAccrued += entries.length - clawbacks.length;
      result.needingReview += entries.filter((e) => e.kind === "ACCRUED" && e.flags.length > 0).length;
      result.clawbacks += clawbacks.length;
      ledgerCache.delete(referral.referrerId);
    }
  }
}
