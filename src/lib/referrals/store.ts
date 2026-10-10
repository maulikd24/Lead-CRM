import type { Party } from "./attribution";
import type { LedgerEntry, LedgerKind } from "./ledger";
import type { RuleSpec } from "./rewards";
import type { Evidence, NewEvent, ReferralEventType } from "./state-machine";

/**
 * Everything the services need from the database, as one injectable interface. Production is `prismaReferralStore`;
 * tests inject an in-memory fake, so the rules are exercised without a database.
 */
export type CodeLookup = { id: string; referrerId: string; status: "ACTIVE" | "REVOKED"; createdAt: Date; revokedAt: Date | null; referrerStatus: "ACTIVE" | "SUSPENDED"; referrer: Party };

export type SavedClaim = { key: string; referrerId: string | null; codeId: string | null; referredClientId: string | null; outcome: "ATTRIBUTED" | "REJECTED"; reason: string | null; attributedAt: Date };

export type AttributedReferral = { id: string; referrerId: string; referredClientId: string; attributedAt: Date };
export type RecordedEvent = { id: string; type: ReferralEventType; occurredAt: Date; amountPaise: number | null };

export type NewLedgerEntry = { idempotencyKey: string; kind: LedgerKind; referrerId: string; referralId: string | null; eventType: ReferralEventType | null; ruleId: string | null; refEntryId: string | null; statementId: string | null; amountPaise: number; periodMonth: string; flags: string[]; note: string | null; actorId: string | null; clawbackUntil?: Date | null };

export type StatementRow = { id: string; referrerId: string; period: string; status: "PREPARED" | "APPROVED" | "PAID"; totalPaise: number; lines: { entryId: string; amountPaise: number; periodMonth: string }[]; preparedById: string; approvedById: string | null; bankReference: string | null };

export interface ReferralStore {
  // attribution
  findClaim(key: string): Promise<{ outcome: "ATTRIBUTED" | "REJECTED"; reason: string | null } | null>;
  findCodeByValue(code: string): Promise<CodeLookup | null>;
  loadParty(clientId: string): Promise<Party | null>;
  isReferred(clientId: string): Promise<boolean>;
  /** Writes the claim; an attributed claim also writes its SIGNED_UP event. "conflict" means the same person or key was written first. */
  saveClaim(claim: SavedClaim): Promise<"saved" | "conflict">;

  // progress and accrual
  listAttributed(limit: number): Promise<AttributedReferral[]>;
  loadProgress(r: AttributedReferral): Promise<{ events: RecordedEvent[]; evidence: Evidence; referrer: Party; referred: Party; siblings: Party[]; attributionsLast24h: number }>;
  listRules(): Promise<RuleSpec[]>;
  getSetting(key: string): Promise<string | null>;
  /** Idempotency keys of the accruals already written for this referral. */
  accrualKeys(referralId: string): Promise<Set<string>>;
  /** Referrals that still have a reward whose clawback window has not ended before `since` (so a finished referral keeps being watched while it can still be taken back). */
  referralsWithOpenClawback(since: Date): Promise<Set<string>>;
  ledgerForReferrerMonth(referrerId: string, month: string): Promise<LedgerEntry[]>;
  /** One transaction: the new events, then the entries (an entry whose idempotency key exists is skipped). */
  commitProgress(c: { referralId: string; events: NewEvent[]; entries: NewLedgerEntry[] }): Promise<void>;

  // ledger and statements
  ledgerForReferrer(referrerId: string): Promise<LedgerEntry[]>;
  appendEntries(entries: NewLedgerEntry[]): Promise<void>;
  getStatement(referrerId: string, period: string): Promise<StatementRow | null>;
  getStatementById(id: string): Promise<StatementRow | null>;
  upsertPreparedStatement(s: { referrerId: string; period: string; totalPaise: number; lines: StatementRow["lines"]; preparedById: string }): Promise<StatementRow>;
  /** Compare-and-set on status, with the ledger entries for the step written in the same transaction; returns false (writing nothing) if someone else moved it first. */
  advanceStatement(id: string, from: StatementRow["status"], to: { status: "APPROVED"; approvedById: string } | { status: "PAID"; paidMarkedById: string; bankReference: string }, entries: NewLedgerEntry[]): Promise<boolean>;
}
