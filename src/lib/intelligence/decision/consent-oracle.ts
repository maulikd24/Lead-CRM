// An INDEPENDENT second implementation of "may we contact this customer on this channel for this purpose at this moment".
// The shadow report uses it to cross-check every stored decision against the consent ledger. It is written on purpose without
// lib/consent/decision.ts so that a bug in one is caught by the other. Keep it simple: newest applicable row wins.
export type OracleRow = { purpose: string; channel: string | null; status: string; capturedAt: Date; expiresAt?: Date | null };
export type OraclePolicy = Record<string, "required" | "default_allow" | "record_only">;

const applies = (r: OracleRow, channel: string, at: Date) => r.capturedAt.getTime() <= at.getTime() && (r.channel === null || r.channel === channel);
const newest = (rows: OracleRow[]) => [...rows].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime() || (a.status === "WITHDRAWN" ? -1 : 1))[0];

export function oracleAllows(rows: OracleRow[], legacyMarketingConsentAt: Date | null, purpose: string, channel: string, at: Date, policy: OraclePolicy): boolean {
  // Do not contact (the latest row decides; GRANTED means the flag is on) stops every contact purpose.
  const dnr = newest(rows.filter((r) => r.purpose === "DO_NOT_CONTACT" && applies(r, channel, at)));
  if (dnr && dnr.status === "GRANTED" && !(dnr.expiresAt && dnr.expiresAt.getTime() <= at.getTime())) return false;
  if (policy[purpose] === "record_only") return true;
  const list = rows.filter((r) => r.purpose === purpose && applies(r, channel, at));
  if (purpose === "MARKETING_COMMS" && legacyMarketingConsentAt && legacyMarketingConsentAt.getTime() <= at.getTime()) list.push({ purpose, channel: null, status: "GRANTED", capturedAt: legacyMarketingConsentAt });
  const last = newest(list);
  if (!last) return policy[purpose] === "default_allow";
  if (last.status === "WITHDRAWN") return false;
  if (last.expiresAt && last.expiresAt.getTime() <= at.getTime()) return policy[purpose] === "default_allow";
  return last.status === "GRANTED";
}
