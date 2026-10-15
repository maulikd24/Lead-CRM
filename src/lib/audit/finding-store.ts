/**
 * Storing audit findings and reading a client's quality summary. Every entry point is behind QUALITY_AUDIT_ENABLED (off unless
 * exactly "1"): while it is off, nothing is written and the summary is null.
 *
 * Storage is behind FindingDbPort so the rules are unit-tested with an in-memory fake. The Prisma implementation is in
 * finding-store.prisma.ts. Idempotency is enforced twice: the in-batch duplicates are removed here (uniqueByKey), and the
 * database refuses a second row with the same dedupeKey (unique index), so a repeated run stores nothing new.
 */
import { type FindingCategory, type FindingDraft, type FindingSeverity, uniqueByKey } from "./findings";

export type FindingRow = FindingDraft;

export type StoredFinding = {
  category: FindingCategory;
  severity: FindingSeverity;
  detectedAt: Date;
};

export type FindingDbPort = {
  /** Inserts the rows whose dedupeKey is not stored yet. Returns how many were inserted. */
  insertIfAbsent(rows: readonly FindingRow[]): Promise<number>;
  /** Open findings (OPEN or ACKNOWLEDGED) for one client. */
  openForClient(clientId: string): Promise<StoredFinding[]>;
};

export const qualityAuditEnabled = (env: Record<string, string | undefined> = process.env): boolean => env.QUALITY_AUDIT_ENABLED === "1";

export type RecordResult = { enabled: boolean; attempted: number; created: number };

/** Stores findings idempotently. Gated: when the flag is off, returns enabled false and touches nothing. */
export async function recordFindings(
  drafts: readonly FindingDraft[],
  port: FindingDbPort,
  env: Record<string, string | undefined> = process.env,
): Promise<RecordResult> {
  if (!qualityAuditEnabled(env)) return { enabled: false, attempted: 0, created: 0 };
  const rows = uniqueByKey(drafts);
  if (rows.length === 0) return { enabled: true, attempted: 0, created: 0 };
  const created = await port.insertIfAbsent(rows);
  return { enabled: true, attempted: rows.length, created };
}

export type ClientQualitySummary = {
  clientId: string;
  openCount: number;
  bySeverity: Record<FindingSeverity, number>;
  byCategory: Record<FindingCategory, number>;
  lastDetectedAt: Date | null;
};

export const FINDING_CATEGORIES: readonly FindingCategory[] = [
  "INCORRECT_COMMUNICATION",
  "POOR_CONVERSATION",
  "MISSED_FOLLOW_UP",
  "MISSED_OPPORTUNITY",
  "CUSTOMER_DISSATISFACTION",
  "COMMITMENT_NOT_COMPLETED",
  "POTENTIAL_COMPLIANCE_ISSUE",
];

/** Pure: counts open findings by severity and category, zero-filled, plus the most recent detection time. */
export function summariseFindings(clientId: string, rows: readonly StoredFinding[]): ClientQualitySummary {
  const bySeverity: Record<FindingSeverity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  const byCategory = Object.fromEntries(FINDING_CATEGORIES.map((c) => [c, 0])) as Record<FindingCategory, number>;
  let lastDetectedAt: Date | null = null;
  for (const r of rows) {
    bySeverity[r.severity] += 1;
    byCategory[r.category] += 1;
    if (!lastDetectedAt || r.detectedAt > lastDetectedAt) lastDetectedAt = r.detectedAt;
  }
  return { clientId, openCount: rows.length, bySeverity, byCategory, lastDetectedAt };
}

/** Read model for the customer profile. Null while the flag is off, so the profile shows nothing rather than an empty count. */
export async function getClientQualitySummary(
  clientId: string,
  port: FindingDbPort,
  env: Record<string, string | undefined> = process.env,
): Promise<ClientQualitySummary | null> {
  if (!qualityAuditEnabled(env)) return null;
  return summariseFindings(clientId, await port.openForClient(clientId));
}
