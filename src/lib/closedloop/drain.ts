import { adsConsentVerdict, destinationVerdict } from "./gate";
import type { ConsentLoader, DestinationContext, DestinationKey, EventResult, OutboxRow, OutboxStore } from "./types";

/** Tries before a row is dead-lettered. */
export const MAX_ATTEMPTS = 6;
/** A claim older than this is a crashed run; the row is sent again (safe: the platform deduplicates on the event id). */
export const STALE_CLAIM_MS = 10 * 60_000;
const BASE_MS = 5 * 60_000;
const CAP_MS = 12 * 3_600_000;
const DAY_MS = 86_400_000;

/** 5 min, 15 min, 45 min, 2h15, 6h45, then 12 h. `attempts` is the number of tries already made. */
export const backoffMs = (attempts: number): number => Math.min(CAP_MS, BASE_MS * 3 ** Math.max(0, attempts - 1));

export type DrainDeps = {
  store: OutboxStore;
  destinations: () => Promise<Map<string, DestinationContext>>;
  loadConsent: ConsentLoader;
  killSwitch: () => boolean;
  now: () => Date;
  /** Rate limit: the most events one destination is sent in one run. */
  maxPerRun: number;
  env?: Record<string, string | undefined>;
};

export type DrainResult = { considered: number; sent: number; retried: number; dead: number; skipped: number; held: Record<string, number>; rateLimited: boolean };

/**
 * Sends what is due. For every row, at send time and not only when it was queued: the kill switch, the destination's
 * state and region, the age the platform accepts, and the customer's CURRENT ad measurement consent. Nothing here can send
 * twice: a row is claimed atomically, a SENT row is never due, and the event id is the dedup key at the platform too.
 * Logs and results carry counts and codes only, never payloads.
 */
export async function drainOutbox(deps: DrainDeps): Promise<DrainResult> {
  const now = deps.now();
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);
  const result: DrainResult = { considered: 0, sent: 0, retried: 0, dead: 0, skipped: 0, held: {}, rateLimited: false };
  const due = await deps.store.due(now, staleBefore, Math.max(deps.maxPerRun * 4, 100));
  result.considered = due.length;
  if (due.length === 0) return result;

  const contexts = await deps.destinations();
  const consent = await deps.loadConsent([...new Set(due.map((r) => r.clientId))]);
  const byDestination = new Map<DestinationKey, OutboxRow[]>();
  for (const r of due) byDestination.set(r.destination, [...(byDestination.get(r.destination) ?? []), r]);

  for (const [key, rows] of byDestination) {
    const ctx = contexts.get(key);
    const verdict = ctx ? destinationVerdict(ctx.settings, { killSwitch: deps.killSwitch() }) : ({ ok: false, reason: deps.killSwitch() ? "KILL_SWITCH" : "DESTINATION_OFF" } as const);
    if (!ctx || !verdict.ok) {
      const reason = verdict.ok ? "DESTINATION_OFF" : verdict.reason;
      result.held[reason] = (result.held[reason] ?? 0) + rows.length;
      continue;
    }
    const { destination } = ctx;
    let budget = deps.maxPerRun;
    let batch: OutboxRow[] = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const claimed: OutboxRow[] = [];
      for (const r of batch) {
        const c = await deps.store.claim(r.id, now, staleBefore);
        if (c) claimed.push(c);
      }
      batch = [];
      if (claimed.length === 0) return;
      let results: EventResult[];
      try {
        results = await destination.send(claimed.map((r) => ({ dedupId: r.dedupId, eventType: r.eventType, qualifier: r.qualifier, occurredAt: r.occurredAt, identity: r.identity, value: r.value })));
      } catch {
        results = claimed.map((r): EventResult => ({ dedupId: r.dedupId, outcome: "retry", errorCode: "network_error" }));
      }
      const byId = new Map(results.map((x) => [x.dedupId, x]));
      for (const r of claimed) {
        const res: EventResult = byId.get(r.dedupId) ?? { dedupId: r.dedupId, outcome: "retry", errorCode: "no_result" };
        if (res.outcome === "sent") {
          await deps.store.markSent(r.id, now, res.matched ?? null);
          result.sent += 1;
        } else if (res.outcome === "rejected" || r.attempts >= MAX_ATTEMPTS) {
          await deps.store.markDead(r.id, res.errorCode ?? "rejected");
          result.dead += 1;
        } else {
          const wait = Math.max(backoffMs(r.attempts), res.retryAfterMs ?? 0);
          await deps.store.markRetry(r.id, new Date(now.getTime() + wait), res.errorCode ?? "error");
          result.retried += 1;
          if (res.retryAfterMs) result.rateLimited = true;
        }
      }
    };

    for (const row of rows) {
      if (budget <= 0 || result.rateLimited) break;
      if (now.getTime() - row.occurredAt.getTime() > destination.maxEventAgeDays * DAY_MS) {
        await deps.store.markSkipped(row.id, "TOO_OLD");
        result.skipped += 1;
        continue;
      }
      const consentOk = adsConsentVerdict(consent.get(row.clientId) ?? [], now, deps.env);
      if (!consentOk.ok) {
        await deps.store.markSkipped(row.id, consentOk.reason);
        result.skipped += 1;
        continue;
      }
      batch.push(row);
      budget -= 1;
      if (batch.length >= destination.maxBatch) await flush();
    }
    await flush();
  }
  return result;
}
