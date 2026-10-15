import { prisma } from "@/lib/db/prisma";
import type { EventConsumer } from "@/lib/events/consumers";

import { closedLoopEnabled, parseGlobalSettings } from "./config";
import { createPrismaOutbox, GLOBAL_PROVIDER, loadAdsConsent, loadCandidates, loadDestinationContexts } from "./db";
import { closedLoopIntakeConsumer } from "./intake";
import { produceOutbox } from "./produce";

const noFetch = async () => ({ status: 0, ok: false, json: async () => ({}) });

/**
 * Queues one customer's conversion events: the same producer the sweep runs, restricted to the customer the event is about. A destination is only ever
 * CONSTRUCTED here (never called): the producer needs its platform to prepare identifiers, and it needs no network to do that.
 */
export async function produceForClient(clientId: string, env: Record<string, string | undefined> = process.env, now: Date = new Date()) {
  const row = await prisma.integrationConfig.findUnique({ where: { provider: GLOBAL_PROVIDER } });
  const global = parseGlobalSettings(row?.settings);
  return produceOutbox({
    store: createPrismaOutbox(prisma),
    loadCandidates: (at) => loadCandidates(at, { lookbackDays: 30, bands: global.aumBands !== null, clientId }, prisma),
    loadConsent: (ids) => loadAdsConsent(ids, prisma),
    destinations: () => loadDestinationContexts(noFetch, env, prisma),
    aumBands: () => global.aumBands,
    now: () => now,
    env,
  });
}

export const createClosedLoopConsumer = (): EventConsumer =>
  closedLoopIntakeConsumer({
    enabled: () => closedLoopEnabled(),
    intakeFor: (clientId) => produceForClient(clientId),
    cancelFor: (clientId) => createPrismaOutbox(prisma).cancelUnsentForClient(clientId, "CONSENT_WITHDRAWN"),
  });
