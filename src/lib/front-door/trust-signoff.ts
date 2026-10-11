import { TRUST_ITEMS, trustStatementHash } from "./trust-config";

/** What is stored (in the existing IntegrationConfig table, provider "landing_trust_signoff"; no migration). */
export type TrustRecord = { statementHash: string; reviewerName: string; reviewedOn: string; recordedById: string; recordedAt: string };

export interface TrustSignoffDb {
  read(): Promise<TrustRecord | null>;
  save(record: TrustRecord): Promise<void>;
  clear(): Promise<void>;
  audit(entry: { userId: string; entity: "TrustStrip"; entityId: string; action: string; oldValue?: unknown; newValue?: unknown }): Promise<void>;
}

export type Change = { ok: true; changed: boolean } | { ok: false; error: string };
const ADMIN_ONLY: Change = { ok: false, error: "Only an Admin can record or revoke the compliance sign-off." };
const isAdmin = (a: { role: string }) => a.role === "ADMIN";

/** The gate: shown only when a record exists, names a reviewer and was made for the CURRENT wording. */
export function isTrustSignedOff(record: TrustRecord | null | undefined, currentHash: string = trustStatementHash(TRUST_ITEMS)): boolean {
  if (!record || typeof record !== "object") return false;
  return record.statementHash === currentHash && typeof record.reviewerName === "string" && record.reviewerName.trim().length > 0 && typeof record.reviewedOn === "string" && record.reviewedOn.length > 0;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function recordTrustSignoff(db: TrustSignoffDb, actor: { id: string; role: string }, input: unknown, now = new Date()): Promise<Change> {
  if (!isAdmin(actor)) return ADMIN_ONLY;
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (i.confirm !== true) return { ok: false, error: "Tick the box to confirm that compliance reviewed this wording." };
  const name = typeof i.reviewerName === "string" ? i.reviewerName.trim() : "";
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Enter the reviewer's name (2 to 80 characters)." };
  const on = typeof i.reviewedOn === "string" ? i.reviewedOn : "";
  const t = DATE.test(on) ? Date.parse(`${on}T00:00:00Z`) : NaN;
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== on) return { ok: false, error: "Enter the review date as YYYY-MM-DD." };
  if (t > now.getTime() + 24 * 3600 * 1000) return { ok: false, error: "The review date cannot be in the future." };

  const hash = trustStatementHash(TRUST_ITEMS);
  if (isTrustSignedOff(await db.read(), hash)) return { ok: true, changed: false };
  const record: TrustRecord = { statementHash: hash, reviewerName: name, reviewedOn: on, recordedById: actor.id, recordedAt: now.toISOString() };
  await db.save(record);
  await db.audit({ userId: actor.id, entity: "TrustStrip", entityId: "signoff", action: "trust_strip_signoff_recorded", newValue: { statementHash: hash, reviewerName: name, reviewedOn: on } });
  return { ok: true, changed: true };
}

export async function revokeTrustSignoff(db: TrustSignoffDb, actor: { id: string; role: string }): Promise<Change> {
  if (!isAdmin(actor)) return ADMIN_ONLY;
  const before = await db.read();
  if (!before) return { ok: true, changed: false };
  await db.clear();
  await db.audit({ userId: actor.id, entity: "TrustStrip", entityId: "signoff", action: "trust_strip_signoff_revoked", oldValue: { reviewerName: before.reviewerName, reviewedOn: before.reviewedOn } });
  return { ok: true, changed: true };
}
