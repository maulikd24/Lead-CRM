import { accrualStates, clawbackStates, planApprove, planClearReview, planConfirmClawback, planMarkPaid, planPrepare, planReversal, planWaiveClawback, statementCandidates, stillClean, type Actor, type LedgerEntry } from "./ledger";
import type { NewLedgerEntry, ReferralStore, StatementRow } from "./store";

type Ok<T = object> = { ok: true } & T;
type Fail = { ok: false; error: string };

const entry = (kind: NewLedgerEntry["kind"], key: string, base: LedgerEntry, actor: Actor, extra: Partial<NewLedgerEntry> = {}): NewLedgerEntry => ({
  idempotencyKey: key, kind, referrerId: base.referrerId, referralId: null, eventType: null, ruleId: null, refEntryId: base.id, statementId: null, amountPaise: base.amountPaise, periodMonth: base.periodMonth, flags: [], note: null, actorId: actor.id, ...extra,
});

export async function prepareStatement(i: { store: ReferralStore; actor: Actor; referrerId: string; period: string }): Promise<Ok<{ statementId: string; totalPaise: number }> | Fail> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(i.period)) return { ok: false, error: "Choose a month." };
  const existing = await i.store.getStatement(i.referrerId, i.period);
  const candidates = statementCandidates(await i.store.ledgerForReferrer(i.referrerId), i.referrerId, i.period);
  const plan = planPrepare({ actor: i.actor, existing: existing && { status: existing.status, preparedById: existing.preparedById, totalPaise: existing.totalPaise }, candidates });
  if (!plan.ok) return plan;
  const row = await i.store.upsertPreparedStatement({ referrerId: i.referrerId, period: i.period, totalPaise: plan.totalPaise, lines: plan.lines.map((e) => ({ entryId: e.id, amountPaise: e.amountPaise, periodMonth: e.periodMonth })), preparedById: i.actor.id });
  return { ok: true, statementId: row.id, totalPaise: row.totalPaise };
}

async function linesOf(store: ReferralStore, s: StatementRow) {
  const ledger = await store.ledgerForReferrer(s.referrerId);
  const byId = new Map(ledger.map((e) => [e.id, e]));
  return { ledger, lines: s.lines.map((l) => byId.get(l.entryId)).filter((e): e is LedgerEntry => !!e) };
}

export async function approveStatement(i: { store: ReferralStore; actor: Actor; statementId: string }): Promise<Ok | Fail> {
  const s = await i.store.getStatementById(i.statementId);
  if (!s) return { ok: false, error: "That statement does not exist." };
  const plan = planApprove({ statement: { status: s.status, preparedById: s.preparedById, totalPaise: s.totalPaise }, actor: i.actor });
  if (!plan.ok) return plan;
  const { ledger, lines } = await linesOf(i.store, s);
  if (lines.length !== s.lines.length || !stillClean(lines, ledger) || lines.reduce((t, e) => t + e.amountPaise, 0) !== s.totalPaise) {
    return { ok: false, error: "Something on this statement changed after it was prepared (a reward was reversed, cleared or clawed back, or a clawback was waived). Prepare the statement again." };
  }
  const moved = await i.store.advanceStatement(s.id, "PREPARED", { status: "APPROVED", approvedById: i.actor.id }, lines.map((e) => entry("APPROVED", `approve:${s.id}:${e.id}`, e, i.actor, { statementId: s.id })));
  return moved ? { ok: true } : { ok: false, error: "Someone else already moved this statement." };
}

export async function markStatementPaid(i: { store: ReferralStore; actor: Actor; statementId: string; bankReference: string }): Promise<Ok | Fail> {
  const s = await i.store.getStatementById(i.statementId);
  if (!s) return { ok: false, error: "That statement does not exist." };
  const plan = planMarkPaid({ statement: { status: s.status, preparedById: s.preparedById, totalPaise: s.totalPaise }, actor: i.actor, bankReference: i.bankReference });
  if (!plan.ok) return plan;
  const { lines } = await linesOf(i.store, s);
  const moved = await i.store.advanceStatement(s.id, "APPROVED", { status: "PAID", paidMarkedById: i.actor.id, bankReference: plan.bankReference }, lines.map((e) => entry("PAID_MARKED", `paid:${s.id}:${e.id}`, e, i.actor, { statementId: s.id, note: plan.bankReference })));
  return moved ? { ok: true } : { ok: false, error: "Someone else already moved this statement." };
}

async function findAccrual(store: ReferralStore, referrerId: string, entryId: string) {
  const ledger = await store.ledgerForReferrer(referrerId);
  const base = ledger.find((e) => e.id === entryId && e.kind === "ACCRUED");
  return base ? { base, state: accrualStates(ledger).get(base.id)! } : null;
}

export async function reverseEntry(i: { store: ReferralStore; actor: Actor; referrerId: string; entryId: string; reason: string }): Promise<Ok | Fail> {
  const found = await findAccrual(i.store, i.referrerId, i.entryId);
  if (!found) return { ok: false, error: "That reward does not exist." };
  const plan = planReversal({ state: found.state, actor: i.actor, reason: i.reason });
  if (!plan.ok) return plan;
  await i.store.appendEntries([entry("REVERSED", `reverse:${found.base.id}`, found.base, i.actor, { note: plan.reason })]);
  return { ok: true };
}

export async function clearReview(i: { store: ReferralStore; actor: Actor; referrerId: string; entryId: string; note: string }): Promise<Ok | Fail> {
  const found = await findAccrual(i.store, i.referrerId, i.entryId);
  if (!found) return { ok: false, error: "That reward does not exist." };
  const plan = planClearReview({ state: found.state, actor: i.actor, note: i.note });
  if (!plan.ok) return plan;
  await i.store.appendEntries([entry("REVIEW_CLEARED", `clear:${found.base.id}`, found.base, i.actor, { amountPaise: 0, note: plan.note })]);
  return { ok: true };
}

async function findClawback(store: ReferralStore, referrerId: string, entryId: string) {
  const ledger = await store.ledgerForReferrer(referrerId);
  const claw = ledger.find((e) => e.id === entryId && e.kind === "CLAWBACK");
  if (!claw) return null;
  const taken = ledger.some((e) => e.kind === "APPROVED" && e.refEntryId === claw.id);
  return { claw, state: clawbackStates(ledger).get(claw.id)!, taken };
}

/** A person has looked at an automatic clawback and agrees with it. */
export async function confirmClawback(i: { store: ReferralStore; actor: Actor; referrerId: string; entryId: string; note: string }): Promise<Ok | Fail> {
  const found = await findClawback(i.store, i.referrerId, i.entryId);
  if (!found) return { ok: false, error: "That clawback does not exist." };
  const plan = planConfirmClawback({ state: found.state, actor: i.actor, note: i.note });
  if (!plan.ok) return plan;
  await i.store.appendEntries([entry("REVIEW_CLEARED", `confirm-claw:${found.claw.id}`, found.claw, i.actor, { amountPaise: 0, note: plan.note })]);
  return { ok: true };
}

/** A person decides the clawback should not stand (for example the KYC was re-approved): a positive entry cancels it. */
export async function waiveClawback(i: { store: ReferralStore; actor: Actor; referrerId: string; entryId: string; reason: string }): Promise<Ok | Fail> {
  const found = await findClawback(i.store, i.referrerId, i.entryId);
  if (!found) return { ok: false, error: "That clawback does not exist." };
  const plan = planWaiveClawback({ state: found.state, taken: found.taken, actor: i.actor, reason: i.reason });
  if (!plan.ok) return plan;
  await i.store.appendEntries([entry("CLAWBACK_WAIVED", `waive-claw:${found.claw.id}`, found.claw, i.actor, { amountPaise: -found.claw.amountPaise, note: plan.reason })]);
  return { ok: true };
}
