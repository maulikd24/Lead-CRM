/**
 * The reward ledger is append-only: nothing is edited. The state of an accrual is derived from the entries that refer to
 * it. The CRM never moves money: PAID_MARKED only records that finance paid it elsewhere, with a bank reference.
 */
export type LedgerKind = "ACCRUED" | "REVIEW_CLEARED" | "REVERSED" | "APPROVED" | "PAID_MARKED" | "CLAWBACK" | "CLAWBACK_WAIVED";
export type AccrualState = "NEEDS_REVIEW" | "ACCRUED" | "APPROVED" | "PAID" | "REVERSED" | "CLAWED_BACK";
/** `referralId`, `eventType`, `ruleId` and `clawbackUntil` are set on accruals; the services that need them read them, the pure ledger maths does not. */
export type LedgerEntry = { id: string; kind: LedgerKind; referrerId: string; amountPaise: number; refEntryId: string | null; flags: string[]; periodMonth: string; referralId?: string | null; eventType?: string | null; ruleId?: string | null; clawbackUntil?: Date | null };

/**
 * Clawbacks. If the referred person's qualifying event is reversed (KYC revoked, funding reversed) inside the rule's
 * window, a CLAWBACK entry is APPENDED (negative amount, pointing at the accrual); history is never edited. It is flagged
 * for review: a person confirms it or waives it (CLAWBACK_WAIVED, a positive entry that cancels it). A reward that never
 * reached a statement is simply cancelled; one already approved or paid is recovered as a negative line on the next statement.
 */
export type ClawbackState = "NEEDS_REVIEW" | "CONFIRMED" | "WAIVED";

export function clawbackStates(entries: LedgerEntry[]): Map<string, ClawbackState> {
  const kindsOf = followerKinds(entries);
  const out = new Map<string, ClawbackState>();
  for (const e of entries) {
    if (e.kind !== "CLAWBACK") continue;
    const f = kindsOf.get(e.id) ?? new Set<LedgerKind>();
    out.set(e.id, f.has("CLAWBACK_WAIVED") ? "WAIVED" : f.has("REVIEW_CLEARED") ? "CONFIRMED" : "NEEDS_REVIEW");
  }
  return out;
}

function followerKinds(entries: LedgerEntry[]): Map<string, Set<LedgerKind>> {
  const m = new Map<string, Set<LedgerKind>>();
  for (const e of entries) {
    if (e.kind === "ACCRUED" || !e.refEntryId) continue;
    const set = m.get(e.refEntryId) ?? new Set<LedgerKind>();
    set.add(e.kind);
    m.set(e.refEntryId, set);
  }
  return m;
}

/** The accrual ids that currently have a live (not waived) clawback. */
function clawedBack(entries: LedgerEntry[]): Set<string> {
  const states = clawbackStates(entries);
  const out = new Set<string>();
  for (const e of entries) if (e.kind === "CLAWBACK" && e.refEntryId && states.get(e.id) !== "WAIVED") out.add(e.refEntryId);
  return out;
}
export type Actor = { id: string; role: string };

export function accrualStates(entries: LedgerEntry[]): Map<string, AccrualState> {
  const followers = followerKinds(entries);
  const taken = clawedBack(entries);
  const out = new Map<string, AccrualState>();
  for (const e of entries) {
    if (e.kind !== "ACCRUED") continue;
    const f = followers.get(e.id) ?? new Set<LedgerKind>();
    let state: AccrualState;
    if (f.has("REVERSED")) state = "REVERSED";
    else if (taken.has(e.id)) state = "CLAWED_BACK";
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

/**
 * What the next statement for this referrer contains: clean accruals up to and including the period that no statement has
 * taken yet (anything in review stays out), plus the recoveries: live clawbacks of rewards that an approved statement had
 * already taken, which no statement has yet recovered. A recovery is a negative line.
 */
export function statementCandidates(entries: LedgerEntry[], referrerId: string, period: string): LedgerEntry[] {
  const states = accrualStates(entries);
  const clean = entries.filter((e) => e.kind === "ACCRUED" && e.referrerId === referrerId && e.periodMonth <= period && states.get(e.id) === "ACCRUED" && e.amountPaise > 0);
  const followers = followerKinds(entries);
  const clawStates = clawbackStates(entries);
  const recoveries = entries.filter((c) => {
    if (c.kind !== "CLAWBACK" || c.referrerId !== referrerId || c.periodMonth > period || c.amountPaise >= 0 || clawStates.get(c.id) === "WAIVED") return false;
    if (followers.get(c.id)?.has("APPROVED")) return false; // a statement already took this recovery
    const f = c.refEntryId ? followers.get(c.refEntryId) : undefined;
    return !!f && (f.has("APPROVED") || f.has("PAID_MARKED")) && !f.has("REVERSED");
  });
  return [...clean, ...recoveries];
}

/** The approval re-check: every line of a prepared statement is still exactly what it was (a clean accrual, or a live recovery nobody has waived or taken). */
export function stillClean(lines: LedgerEntry[], ledger: LedgerEntry[]): boolean {
  const states = accrualStates(ledger);
  const clawStates = clawbackStates(ledger);
  const followers = followerKinds(ledger);
  return lines.every((l) => (l.kind === "ACCRUED" ? states.get(l.id) === "ACCRUED" : l.kind === "CLAWBACK" ? clawStates.get(l.id) !== "WAIVED" && !followers.get(l.id)?.has("APPROVED") : false));
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
  const total = i.candidates.reduce((s, e) => s + e.amountPaise, 0);
  if (total <= 0) return fail("After taking back rewards that were already approved, nothing is payable. The balance carries forward and is netted off the next rewards.");
  return { ok: true, lines: i.candidates, totalPaise: total };
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
  if (i.state === "CLAWED_BACK") return fail("This reward has already been taken back (clawback).");
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

export function planConfirmClawback(i: { state: ClawbackState; actor: Actor; note: string }): { ok: true; note: string } | Fail {
  if (!roleOk(i.actor)) return fail("Only Admin or Finance can confirm a clawback.");
  if (i.state !== "NEEDS_REVIEW") return fail("This clawback is not waiting for review.");
  const note = i.note.trim();
  if (note.length < 5) return fail("Write what you checked (at least a few words).");
  return { ok: true, note: note.slice(0, 300) };
}

/** `taken`: an approved statement has already recovered it, so it can no longer be waived here. */
export function planWaiveClawback(i: { state: ClawbackState; taken: boolean; actor: Actor; reason: string }): { ok: true; reason: string } | Fail {
  if (!roleOk(i.actor)) return fail("Only Admin or Finance can waive a clawback.");
  if (i.state === "WAIVED") return fail("This clawback is already waived.");
  if (i.taken) return fail("This clawback is already on an approved statement. Adjust it with the payment outside the CRM.");
  const reason = i.reason.trim();
  if (reason.length < 5) return fail("Give a reason (at least a few words).");
  return { ok: true, reason: reason.slice(0, 300) };
}
