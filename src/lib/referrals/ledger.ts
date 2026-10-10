/**
 * The reward ledger is append-only: nothing is edited. The state of an accrual is derived from the entries that refer to
 * it. The CRM never moves money: PAID_MARKED only records that finance paid it elsewhere, with a bank reference.
 */
export type LedgerKind = "ACCRUED" | "REVIEW_CLEARED" | "REVERSED" | "APPROVED" | "PAID_MARKED";
export type AccrualState = "NEEDS_REVIEW" | "ACCRUED" | "APPROVED" | "PAID" | "REVERSED";
export type LedgerEntry = { id: string; kind: LedgerKind; referrerId: string; amountPaise: number; refEntryId: string | null; flags: string[]; periodMonth: string };
export type Actor = { id: string; role: string };

export function accrualStates(entries: LedgerEntry[]): Map<string, AccrualState> {
  const followers = new Map<string, Set<LedgerKind>>();
  for (const e of entries) {
    if (e.kind === "ACCRUED" || !e.refEntryId) continue;
    const set = followers.get(e.refEntryId) ?? new Set<LedgerKind>();
    set.add(e.kind);
    followers.set(e.refEntryId, set);
  }
  const out = new Map<string, AccrualState>();
  for (const e of entries) {
    if (e.kind !== "ACCRUED") continue;
    const f = followers.get(e.id) ?? new Set<LedgerKind>();
    let state: AccrualState;
    if (f.has("REVERSED")) state = "REVERSED";
    else if (f.has("PAID_MARKED")) state = "PAID";
    else if (f.has("APPROVED")) state = "APPROVED";
    else if (e.flags.length > 0 && !f.has("REVIEW_CLEARED")) state = "NEEDS_REVIEW";
    else state = "ACCRUED";
    out.set(e.id, state);
  }
  return out;
}

/** What the monthly cap counts: the referrer's accruals for the month that have not been reversed. */
export function netAccruedInMonth(entries: LedgerEntry[], referrerId: string, month: string): number {
  const states = accrualStates(entries);
  let total = 0;
  for (const e of entries) if (e.kind === "ACCRUED" && e.referrerId === referrerId && e.periodMonth === month && states.get(e.id) !== "REVERSED") total += e.amountPaise;
  return total;
}

/** Clean accruals up to and including the period that no statement has taken yet. Anything in review stays out. */
export function statementCandidates(entries: LedgerEntry[], referrerId: string, period: string): LedgerEntry[] {
  const states = accrualStates(entries);
  return entries.filter((e) => e.kind === "ACCRUED" && e.referrerId === referrerId && e.periodMonth <= period && states.get(e.id) === "ACCRUED" && e.amountPaise > 0);
}

export type StatementSnapshot = { status: "PREPARED" | "APPROVED" | "PAID"; preparedById: string; totalPaise: number };
type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const MONEY_ROLES = new Set(["ADMIN", "FINANCE"]);
const roleOk = (a: Actor) => MONEY_ROLES.has(a.role);

export function planPrepare(i: { actor: Actor; existing: StatementSnapshot | null; candidates: LedgerEntry[] }): { ok: true; lines: LedgerEntry[]; totalPaise: number } | Fail {
  if (!roleOk(i.actor)) return fail("Only Admin or Finance can prepare a statement.");
  if (i.existing && i.existing.status !== "PREPARED") return fail("This statement is already approved. It cannot be prepared again.");
  if (i.candidates.length === 0) return fail("There is nothing to put on a statement for this referrer yet.");
  return { ok: true, lines: i.candidates, totalPaise: i.candidates.reduce((s, e) => s + e.amountPaise, 0) };
}

export const FOUR_EYES_MESSAGE = "Approval needs a second pair of eyes: someone other than the person who prepared this statement must approve it.";

export function planApprove(i: { statement: StatementSnapshot; actor: Actor }): { ok: true } | Fail {
  if (!roleOk(i.actor)) return fail("Only Admin or Finance can approve a statement.");
  if (i.statement.status !== "PREPARED") return fail("Only a prepared statement can be approved.");
  if (i.statement.totalPaise <= 0) return fail("A statement with nothing to pay cannot be approved.");
  if (!i.statement.preparedById || i.statement.preparedById === i.actor.id) return fail(FOUR_EYES_MESSAGE);
  return { ok: true };
}

const BANK_REF = /^[A-Za-z0-9][A-Za-z0-9\-/_]{5,39}$/;

export function planMarkPaid(i: { statement: StatementSnapshot; actor: Actor; bankReference: string }): { ok: true; bankReference: string } | Fail {
  if (!roleOk(i.actor)) return fail("Only Admin or Finance can mark a statement paid.");
  if (i.statement.status !== "APPROVED") return fail("Only an approved statement can be marked paid.");
  const ref = i.bankReference.trim();
  if (!BANK_REF.test(ref)) return fail("Enter the bank reference (6 to 40 letters, digits, dash or slash). This only records a payment made outside the CRM.");
  return { ok: true, bankReference: ref };
}

export function planReversal(i: { state: AccrualState; actor: Actor; reason: string }): { ok: true; reason: string } | Fail {
  if (!roleOk(i.actor)) return fail("Only Admin or Finance can reverse a reward.");
  if (i.state !== "ACCRUED" && i.state !== "NEEDS_REVIEW") return fail("A reward already on an approved statement cannot be reversed here.");
  const reason = i.reason.trim();
  if (reason.length < 3) return fail("Give a reason.");
  return { ok: true, reason: reason.slice(0, 300) };
}

export function planClearReview(i: { state: AccrualState; actor: Actor; note: string }): { ok: true; note: string } | Fail {
  if (!roleOk(i.actor)) return fail("Only Admin or Finance can clear a review.");
  if (i.state !== "NEEDS_REVIEW") return fail("This reward is not waiting for review.");
  const note = i.note.trim();
  if (note.length < 5) return fail("Write what you checked (at least a few words).");
  return { ok: true, note: note.slice(0, 300) };
}
