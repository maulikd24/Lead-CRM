import { prisma } from "@/lib/db/prisma";

import type { FetchLike } from "./adapters/meta-capi";
import { closedLoopEnabled, killSwitchOn } from "./config";
import { createPrismaOutbox, loadAdsConsent, loadCandidates, loadDestinationContexts, loadGlobalSettings } from "./db";
import { drainOutbox, type DrainResult } from "./drain";
import { produceOutbox, type ProduceResult } from "./produce";

const realFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: AbortSignal.timeout(15_000) });
  return { status: res.status, ok: res.ok, json: () => res.json() };
};

export type ClosedLoopJobResult = { skipped: string } | { produced: ProduceResult; drained: DrainResult };

/**
 * The cron job: a no-op unless CLOSED_LOOP_CONVERSIONS_ENABLED=1. Queues events from existing client data, then sends what is
 * due. Counts only, never payloads. `fetchImpl` is injectable so a test never touches a network.
 */
export async function runClosedLoopJob(opts: { env?: Record<string, string | undefined>; fetchImpl?: FetchLike; now?: () => Date } = {}): Promise<ClosedLoopJobResult> {
  const env = opts.env ?? process.env;
  if (!closedLoopEnabled(env)) return { skipped: "flag off" };
  const fetchImpl = opts.fetchImpl ?? realFetch;
  const now = opts.now ?? (() => new Date());
  const store = createPrismaOutbox(prisma);
  const global = await loadGlobalSettings(prisma);
  const lookbackDays = Math.min(30, Math.max(1, Number(env.CLOSED_LOOP_LOOKBACK_DAYS) || 7));
  const destinations = () => loadDestinationContexts(fetchImpl, env, prisma);

  const produced = await produceOutbox({
    store,
    loadCandidates: (at) => loadCandidates(at, { lookbackDays, bands: global.aumBands !== null }, prisma),
    loadConsent: (ids) => loadAdsConsent(ids, prisma),
    destinations,
    aumBands: () => global.aumBands,
    now,
    env,
  });
  const drained = await drainOutbox({ store, destinations, loadConsent: (ids) => loadAdsConsent(ids, prisma), killSwitch: () => killSwitchOn(env, global), now, maxPerRun: Math.max(1, Number(env.CLOSED_LOOP_MAX_PER_RUN) || 200), env });
  return { produced, drained };
}
