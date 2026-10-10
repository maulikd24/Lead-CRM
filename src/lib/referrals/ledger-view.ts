import { accrualStates, clawbackStates, type AccrualState, type ClawbackState, type LedgerEntry, type LedgerKind } from "./ledger";

/**
 * The ledger as a person reads it: one row per reward, with the entries that followed it (its history) and, if it was taken
 * back, the clawback and where that stands. Pure: the page loads the raw entries and the names and this assembles them.
 */
export type RawEntry = { id: string; kind: LedgerKind; referrerId: string; referralId: string | null; eventType: string | null; ruleId: string | null; refEntryId: string | null; amountPaise: number; periodMonth: string; flags: string[]; note: string | null; actorId: string | null; clawbackUntil: Date | null; createdAt: Date };

export type HistoryItem = { kind: LedgerKind; at: Date; amountPaise: number; note: string | null; by: string | null };
export type ClawbackView = { id: string; state: ClawbackState; amountPaise: number; flags: string[]; note: string | null; at: Date; /** An approved statement has recovered it. */ taken: boolean };
export type LedgerRow = { id: string; referrerId: string; referrerName: string; referredCode: string | null; event: string | null; ruleName: string | null; amountPaise: number; periodMonth: string; state: AccrualState; flags: string[]; at: Date; clawbackUntil: Date | null; history: HistoryItem[]; clawback: ClawbackView | null };
export type RowAction = "clear" | "reverse" | "confirm_clawback" | "waive_clawback";

type Names = { referrerNames: Map<string, string>; referredCodes: Map<string, string | null>; ruleNames: Map<string, string>; actorNames: Map<string, string> };

const toLedger = (e: RawEntry): LedgerEntry => ({ id: e.id, kind: e.kind, referrerId: e.referrerId, amountPaise: e.amountPaise, refEntryId: e.refEntryId, flags: e.flags, periodMonth: e.periodMonth, referralId: e.referralId, eventType: e.eventType, ruleId: e.ruleId, clawbackUntil: e.clawbackUntil });

export function assembleLedger(entries: RawEntry[], names: Names): LedgerRow[] {
  const ledger = entries.map(toLedger);
  const states = accrualStates(ledger);
  const clawStates = clawbackStates(ledger);
  const byRef = new Map<string, RawEntry[]>();
  for (const e of entries) if (e.refEntryId) byRef.set(e.refEntryId, [...(byRef.get(e.refEntryId) ?? []), e]);
  const rows: LedgerRow[] = [];
  for (const a of entries) {
    if (a.kind !== "ACCRUED") continue;
    const followers = (byRef.get(a.id) ?? []).slice().sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
    const c = followers.find((f) => f.kind === "CLAWBACK");
    const by = (id: string | null) => (id ? (names.actorNames.get(id) ?? null) : null);
    const history: HistoryItem[] = [{ kind: "ACCRUED", at: a.createdAt, amountPaise: a.amountPaise, note: a.note, by: by(a.actorId) }];
    for (const f of followers) {
      history.push({ kind: f.kind, at: f.createdAt, amountPaise: f.amountPaise, note: f.note, by: by(f.actorId) });
      if (f.kind === "CLAWBACK") for (const g of byRef.get(f.id) ?? []) history.push({ kind: g.kind, at: g.createdAt, amountPaise: g.amountPaise, note: g.note, by: by(g.actorId) });
    }
    history.sort((x, y) => x.at.getTime() - y.at.getTime());
    rows.push({
      id: a.id,
      referrerId: a.referrerId,
      referrerName: names.referrerNames.get(a.referrerId) ?? "Former referrer",
      referredCode: a.referralId ? (names.referredCodes.get(a.referralId) ?? null) : null,
      event: a.eventType,
      ruleName: a.ruleId ? (names.ruleNames.get(a.ruleId) ?? "Deleted rule") : null,
      amountPaise: a.amountPaise,
      periodMonth: a.periodMonth,
      state: states.get(a.id)!,
      flags: a.flags,
      at: a.createdAt,
      clawbackUntil: a.clawbackUntil,
      history,
      clawback: c ? { id: c.id, state: clawStates.get(c.id)!, amountPaise: c.amountPaise, flags: c.flags, note: c.note, at: c.createdAt, taken: (byRef.get(c.id) ?? []).some((g) => g.kind === "APPROVED") } : null,
    });
  }
  // Anything waiting for a person comes first; the rest stay newest first.
  const rank = (r: LedgerRow) => (r.state === "NEEDS_REVIEW" || r.clawback?.state === "NEEDS_REVIEW" ? 0 : 1);
  return rows.sort((x, y) => rank(x) - rank(y) || y.at.getTime() - x.at.getTime());
}

export function rowActions(r: Pick<LedgerRow, "state" | "clawback">): RowAction[] {
  const out: RowAction[] = [];
  if (r.state === "NEEDS_REVIEW") out.push("clear", "reverse");
  else if (r.state === "ACCRUED") out.push("reverse");
  const c = r.clawback;
  if (c && c.state !== "WAIVED") {
    if (c.state === "NEEDS_REVIEW") out.push("confirm_clawback");
    if (!c.taken) out.push("waive_clawback");
  }
  return out;
}
