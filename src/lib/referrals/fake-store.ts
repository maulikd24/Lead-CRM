import type { Party } from "./attribution";
import type { LedgerEntry } from "./ledger";
import type { RuleSpec } from "./rewards";
import type { Evidence, NewEvent } from "./state-machine";
import type { AttributedReferral, CodeLookup, NewLedgerEntry, RecordedEvent, ReferralStore, SavedClaim, StatementRow } from "./store";

/** In-memory ReferralStore for tests: same rules as the database (unique idempotency keys, one referral per person). */
export class FakeStore implements ReferralStore {
  codes = new Map<string, CodeLookup>();
  parties = new Map<string, Party>();
  claims = new Map<string, SavedClaim>();
  referrals: (AttributedReferral & { evidence: Evidence })[] = [];
  events = new Map<string, RecordedEvent[]>();
  rules: RuleSpec[] = [];
  settings = new Map<string, string>();
  ledger: (LedgerEntry & { key: string; statementId: string | null })[] = [];
  statements: StatementRow[] = [];
  private seq = 0;
  private id = (p: string) => `${p}${++this.seq}`;

  async findClaim(key: string) {
    const c = this.claims.get(key);
    return c ? { outcome: c.outcome, reason: c.reason } : null;
  }
  async findCodeByValue(code: string) {
    return this.codes.get(code) ?? null;
  }
  async loadParty(clientId: string) {
    return this.parties.get(clientId) ?? null;
  }
  async isReferred(clientId: string) {
    return [...this.claims.values()].some((c) => c.referredClientId === clientId && c.outcome === "ATTRIBUTED");
  }
  async saveClaim(claim: SavedClaim) {
    if (this.claims.has(claim.key)) return "conflict" as const;
    if (claim.referredClientId && [...this.claims.values()].some((c) => c.referredClientId === claim.referredClientId)) return "conflict" as const;
    this.claims.set(claim.key, claim);
    if (claim.outcome === "ATTRIBUTED" && claim.referrerId && claim.referredClientId) {
      const id = this.id("ref");
      this.referrals.push({ id, referrerId: claim.referrerId, referredClientId: claim.referredClientId, attributedAt: claim.attributedAt, evidence: { kycApprovedAt: null, firstFundedAt: null, fundedAmountPaise: null } });
      this.events.set(id, [{ id: this.id("ev"), type: "SIGNED_UP", occurredAt: claim.attributedAt, amountPaise: null }]);
    }
    return "saved" as const;
  }
  async listAttributed(limit: number) {
    return this.referrals.slice(0, limit).map(({ evidence: _e, ...r }) => r);
  }
  async loadProgress(r: AttributedReferral) {
    const row = this.referrals.find((x) => x.id === r.id)!;
    const referrer = this.parties.get(`referrer-of:${r.referrerId}`)!;
    const siblings = this.referrals.filter((x) => x.referrerId === r.referrerId).map((x) => this.parties.get(x.referredClientId)!);
    const dayAgo = r.attributedAt.getTime() - 86_400_000;
    const mine = this.referrals.filter((x) => x.referrerId === r.referrerId);
    const last24 = mine.filter((x) => mine.indexOf(x) <= mine.indexOf(row) && x.attributedAt.getTime() > dayAgo).length;
    return { events: this.events.get(r.id) ?? [], evidence: row.evidence, referrer, referred: this.parties.get(r.referredClientId)!, siblings, attributionsLast24h: last24 };
  }
  async listRules() {
    return this.rules;
  }
  async getSetting(key: string) {
    return this.settings.get(key) ?? null;
  }
  async accrualKeys(referralId: string) {
    return new Set(this.ledger.filter((e) => e.kind === "ACCRUED" && e.key.startsWith(`accrue:${referralId}:`)).map((e) => e.key));
  }
  async referralsWithOpenClawback(since: Date) {
    return new Set(this.ledger.filter((e) => e.kind === "ACCRUED" && e.referralId && e.clawbackUntil && e.clawbackUntil.getTime() >= since.getTime()).map((e) => e.referralId as string));
  }
  async ledgerForReferrerMonth(referrerId: string, month: string) {
    return this.ledger.filter((e) => e.referrerId === referrerId && e.periodMonth === month);
  }
  async commitProgress(c: { referralId: string; events: NewEvent[]; entries: NewLedgerEntry[] }) {
    const list = this.events.get(c.referralId) ?? [];
    for (const e of c.events) if (!list.some((x) => x.type === e.type)) list.push({ id: this.id("ev"), type: e.type, occurredAt: e.occurredAt, amountPaise: e.amountPaise });
    this.events.set(c.referralId, list);
    await this.appendEntries(c.entries);
  }
  async ledgerForReferrer(referrerId: string) {
    return this.ledger.filter((e) => e.referrerId === referrerId);
  }
  async appendEntries(entries: NewLedgerEntry[]) {
    for (const e of entries) {
      if (this.ledger.some((x) => x.key === e.idempotencyKey)) continue;
      this.ledger.push({ id: this.id("le"), key: e.idempotencyKey, kind: e.kind, referrerId: e.referrerId, amountPaise: e.amountPaise, refEntryId: e.refEntryId, flags: e.flags, periodMonth: e.periodMonth, statementId: e.statementId, referralId: e.referralId, eventType: e.eventType, ruleId: e.ruleId, clawbackUntil: e.clawbackUntil ?? null });
    }
  }
  async getStatement(referrerId: string, period: string) {
    return this.statements.find((s) => s.referrerId === referrerId && s.period === period) ?? null;
  }
  async getStatementById(id: string) {
    return this.statements.find((s) => s.id === id) ?? null;
  }
  async upsertPreparedStatement(s: { referrerId: string; period: string; totalPaise: number; lines: StatementRow["lines"]; preparedById: string }) {
    const existing = await this.getStatement(s.referrerId, s.period);
    if (existing) return Object.assign(existing, { totalPaise: s.totalPaise, lines: s.lines, preparedById: s.preparedById });
    const row: StatementRow = { id: this.id("st"), referrerId: s.referrerId, period: s.period, status: "PREPARED", totalPaise: s.totalPaise, lines: s.lines, preparedById: s.preparedById, approvedById: null, bankReference: null };
    this.statements.push(row);
    return row;
  }
  async advanceStatement(id: string, from: StatementRow["status"], to: { status: "APPROVED"; approvedById: string } | { status: "PAID"; paidMarkedById: string; bankReference: string }, entries: NewLedgerEntry[]) {
    const s = this.statements.find((x) => x.id === id);
    if (!s || s.status !== from) return false;
    await this.appendEntries(entries);
    s.status = to.status;
    if (to.status === "APPROVED") s.approvedById = to.approvedById;
    else s.bankReference = to.bankReference;
    return true;
  }
}
