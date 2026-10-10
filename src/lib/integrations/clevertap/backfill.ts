import { emailKey, phoneKey } from "@/lib/clients/identity-keys";
import { distinctAppUserIds } from "./identity";

/**
 * Backfill of the app user id link for customers created before the signup ledger pointed at them. It only ever
 * re-points an existing signup ledger row (LeadIntake, source allvest_app) at a customer, and only on strong evidence:
 *  - the row points at a customer that was merged away: the survivor is the answer (the ledger itself is the evidence);
 *  - the row points at nobody: its stored phone and email must single out exactly ONE live customer, and agree.
 * Anything else is skipped with a reason. Nothing is guessed, nothing is invented (no row is created), and the report
 * holds row and customer ids only, never a phone, an email or an app user id.
 */

export type StaleRow = { id: string; externalId: string; clientId: string | null; phoneKey: string | null; email: string | null };

export type SkipReason =
  | "already_linked"
  | "customer_gone"
  | "customer_has_other_app_id"
  | "competing_app_ids"
  | "unusable_id"
  | "no_contact"
  | "no_match"
  | "ambiguous";

export type LinkBasis = "merged_into_survivor" | "unique_phone_and_email" | "unique_phone" | "unique_email";

export type Decision =
  | { rowId: string; action: "link"; clientId: string; basis: LinkBasis }
  | { rowId: string; action: "skip"; reason: SkipReason };

export type BackfillDeps = {
  /** The live customer a customer id resolves to (follows merges), or null when it is gone, erased or looping. */
  resolveLive(clientId: string): Promise<string | null>;
  /** Live customers whose mobileKey (see phoneKey) is this key. */
  clientsByPhoneKey(key: string): Promise<string[]>;
  /** Live customers whose emailKey is this key. */
  clientsByEmail(email: string): Promise<string[]>;
  /** The app user ids already filed on a customer. */
  appIdsOf(clientId: string): Promise<string[]>;
  /** Compare-and-set: re-point the row only if it still points at `from`. False when it no longer does. */
  link(rowId: string, from: string | null, to: string): Promise<boolean>;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Pure. Reads the phone key and email key out of a ledger payload, from the normalised lead or the stored contract. */
export function contactFromPayload(payload: unknown): { phoneKey: string | null; email: string | null } {
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const p = obj(payload);
  const n = obj(p.normalized);
  const r = obj(p.raw);
  const rawPhone = str(n.phone) ?? str(r.mobile) ?? str(p.mobile) ?? str(p.phone);
  const rawEmail = str(n.email) ?? str(r.email) ?? str(p.email);
  // The one shared identity rule (src/lib/clients/identity-keys.ts); no normalisation of our own.
  const email = rawEmail && /^[^\s@]+@[^\s@]+$/.test(rawEmail) ? emailKey(rawEmail) : null;
  const key = phoneKey(rawPhone);
  return { phoneKey: key && key.length >= 10 ? key : null, email };
}

const skip = (rowId: string, reason: SkipReason): Decision => ({ rowId, action: "skip", reason });

async function decide(r: StaleRow, deps: BackfillDeps): Promise<Decision> {
  const ext = distinctAppUserIds([{ externalId: r.externalId }])[0];
  if (!ext) return skip(r.id, "unusable_id");

  let target: string;
  let basis: LinkBasis;
  if (r.clientId) {
    const live = await deps.resolveLive(r.clientId);
    if (!live) return skip(r.id, "customer_gone");
    if (live === r.clientId) return skip(r.id, "already_linked");
    target = live;
    basis = "merged_into_survivor";
  } else {
    if (!r.phoneKey && !r.email) return skip(r.id, "no_contact");
    const byPhone = r.phoneKey ? [...new Set(await deps.clientsByPhoneKey(r.phoneKey))] : [];
    const byEmail = r.email ? [...new Set(await deps.clientsByEmail(r.email))] : [];
    const all = [...new Set([...byPhone, ...byEmail])];
    if (all.length === 0) return skip(r.id, "no_match");
    // Every contact the row has must point at the same single customer; anything less is not strong enough.
    const bothGiven = !!r.phoneKey && !!r.email;
    if (all.length !== 1 || (bothGiven && (byPhone.length !== 1 || byEmail.length !== 1))) return skip(r.id, "ambiguous");
    target = all[0];
    basis = bothGiven ? "unique_phone_and_email" : r.phoneKey ? "unique_phone" : "unique_email";
  }

  const others = (await deps.appIdsOf(target)).map((i) => i.trim()).filter((i) => i && i !== ext);
  if (others.length > 0) return skip(r.id, "customer_has_other_app_id");
  return { rowId: r.id, action: "link", clientId: target, basis };
}

/** Read-only. One decision per row, in order. Two different app ids that would land on one customer are both skipped. */
export async function planBackfill(rows: StaleRow[], deps: BackfillDeps): Promise<Decision[]> {
  const decisions: Decision[] = [];
  for (const r of rows) decisions.push(await decide(r, deps));

  const extOf = new Map(rows.map((r) => [r.id, r.externalId.trim()]));
  const idsByClient = new Map<string, Set<string>>();
  for (const d of decisions) if (d.action === "link") (idsByClient.get(d.clientId) ?? idsByClient.set(d.clientId, new Set()).get(d.clientId)!).add(extOf.get(d.rowId)!);
  return decisions.map((d) => (d.action === "link" && (idsByClient.get(d.clientId)?.size ?? 0) > 1 ? skip(d.rowId, "competing_app_ids") : d));
}

export type ApplyResult = { linked: number; skipped: number; wouldLink: number };

/** Dry run counts what would be linked and writes nothing. A link that lost a race (the row moved meanwhile) counts as skipped. */
export async function applyBackfill(plan: Decision[], rows: StaleRow[], deps: BackfillDeps, opts: { dryRun: boolean }): Promise<ApplyResult> {
  const from = new Map(rows.map((r) => [r.id, r.clientId]));
  const out: ApplyResult = { linked: 0, skipped: 0, wouldLink: 0 };
  for (const d of plan) {
    if (d.action !== "link") continue;
    if (opts.dryRun) { out.wouldLink++; continue; }
    if (await deps.link(d.rowId, from.get(d.rowId) ?? null, d.clientId)) out.linked++;
    else out.skipped++;
  }
  return out;
}
