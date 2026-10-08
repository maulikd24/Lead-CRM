import { basePrisma, prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { onEvent } from "@/lib/journeys/dispatch";
import { loadCustomerFacts, type CustomerFacts } from "./facts";
import { computeLifecycleStage } from "./lifecycle";
import { computeAcceptance, isHniProfile, type AcceptanceMap } from "./acceptance";
import { detectSituations, type Situation } from "./situations";
import { computeNextBestAction, type NextBestActionV2 } from "./nba";
import { evaluateSegments } from "./segments";
import { ASSET_CLASSES, SEGMENTS, type LifecycleStage, type SegmentKey } from "./constants";

export type IntelligenceResult = {
  facts: CustomerFacts;
  lifecycle: LifecycleStage;
  acceptance: AcceptanceMap;
  situations: Situation[];
  nba: NextBestActionV2;
  segments: SegmentKey[];
};

/** Pure computation, no writes — what the engines conclude about this customer right now. */
export function computeIntelligence(facts: CustomerFacts): IntelligenceResult {
  const lifecycle = computeLifecycleStage(facts);
  const acceptance = computeAcceptance(facts);
  const situations = detectSituations(facts, lifecycle);
  const nba = computeNextBestAction(facts, lifecycle, situations, acceptance, { aiAgentsEnabled: process.env.AI_AGENTS_ENABLED === "1" });
  const segments = [...evaluateSegments(facts, lifecycle, nba, situations)];
  return { facts, lifecycle, acceptance, situations, nba, segments };
}

function inferCategory(facts: CustomerFacts): string | null {
  if (facts.client.customerCategory) return null;
  if (isHniProfile(facts) && (facts.client.clientType ?? "").toUpperCase().includes("HNI")) return "HNI";
  const category = facts.client.investmentCategory;
  if (category === "Broking") return "Broking";
  if (category === "Wealth" || category === "Wealth & Broking") return "Wealth";
  if ((facts.client.productInterest ?? "").toLowerCase().includes("mutual")) return "Mutual Funds";
  return null;
}

/**
 * Computes a customer's intelligence and stores it: lifecycle, Next Best Action, acceptance and segments.
 * These are derived values, so they are written with the plain client — the Activity Log is for what people do.
 * Journeys are only triggered by a segment entry when this isn't the customer's first computation (otherwise the
 * first backfill would enrol everybody who is already dormant).
 */
export async function refreshCustomerIntelligence(clientId: string, opts: { fireTriggers?: boolean } = {}): Promise<IntelligenceResult | null> {
  const facts = await loadCustomerFacts(clientId);
  if (!facts) return null;
  const result = computeIntelligence(facts);
  const { lifecycle, acceptance, situations, nba, segments } = result;

  const existing = await basePrisma.customerIntelligence.findUnique({ where: { clientId }, select: { lifecycleStage: true } });
  const computed = {
    nbaProgramme: nba.programme,
    nbaAction: nba.action,
    nbaTopic: nba.topic,
    nbaReason: nba.reason,
    nbaPriority: nba.priority,
    nbaOwner: nba.owner,
    nbaTiming: nba.timing,
    priorityScore: nba.priorityScore,
    talkingPoints: nba.talkingPoints as unknown as Prisma.InputJsonValue,
    situations: situations as unknown as Prisma.InputJsonValue,
    doNotDiscuss: nba.doNotDiscuss as unknown as Prisma.InputJsonValue,
    computedAt: new Date(),
  };
  await basePrisma.customerIntelligence.upsert({
    where: { clientId },
    update: { ...computed, lifecycleStage: lifecycle, ...(existing?.lifecycleStage !== lifecycle ? { lifecycleUpdatedAt: new Date() } : {}) },
    create: { clientId, lifecycleStage: lifecycle, ...computed },
  });

  // Non-manual acceptance rows track the engine; a manual row is the RM's and is left alone.
  const manual = new Set(facts.manualAcceptance.map((m) => m.assetClass));
  await Promise.all(
    ASSET_CLASSES.filter((c) => !manual.has(c)).map((assetClass) =>
      basePrisma.assetClassAcceptance.upsert({
        where: { clientId_assetClass: { clientId, assetClass } },
        update: { level: acceptance[assetClass].level, source: acceptance[assetClass].source, reason: acceptance[assetClass].reason },
        create: { clientId, assetClass, level: acceptance[assetClass].level, source: acceptance[assetClass].source, reason: acceptance[assetClass].reason },
      }),
    ),
  );

  const category = inferCategory(facts);
  if (category) await basePrisma.client.update({ where: { id: clientId }, data: { customerCategory: category } });

  const entered = await syncSegments(clientId, new Set(segments));
  const fire = opts.fireTriggers ?? (!!existing || Date.now() - facts.client.createdAt.getTime() < 24 * 60 * 60 * 1000);
  if (fire) {
    for (const segment of entered) {
      try {
        await onEvent("segment_entered", clientId, { segment });
      } catch (error) {
        console.error(`Journey trigger for segment ${segment} failed`, error);
      }
    }
  }
  return result;
}

/** Records segment entries/exits and returns the ones the customer has just entered. */
async function syncSegments(clientId: string, current: Set<SegmentKey>): Promise<SegmentKey[]> {
  const rows = await basePrisma.segmentMembership.findMany({ where: { clientId } });
  const byKey = new Map(rows.map((r) => [r.segment, r]));
  const entered: SegmentKey[] = [];

  for (const key of Object.keys(SEGMENTS) as SegmentKey[]) {
    const row = byKey.get(key);
    if (current.has(key)) {
      if (!row) {
        await basePrisma.segmentMembership.create({ data: { clientId, segment: key } });
        entered.push(key);
      } else if (row.exitedAt) {
        await basePrisma.segmentMembership.update({ where: { id: row.id }, data: { enteredAt: new Date(), exitedAt: null } });
        entered.push(key);
      }
    } else if (row && !row.exitedAt) {
      await basePrisma.segmentMembership.update({ where: { id: row.id }, data: { exitedAt: new Date() } });
    }
  }
  return entered;
}

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** Cron: first customers with no intelligence yet, then the stalest, a few at a time. */
export async function refreshStaleIntelligence(limit = 25) {
  const base: Prisma.ClientWhereInput = { isDeleted: false, mergedIntoId: null };
  const fresh = await prisma.client.findMany({ where: { ...base, intelligence: { is: null } }, select: { id: true }, orderBy: { createdAt: "desc" }, take: limit });
  const ids = fresh.map((c) => c.id);
  if (ids.length < limit) {
    const stale = await prisma.customerIntelligence.findMany({
      where: { computedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) }, client: { ...base, status: { not: "NOT_PROCEEDING" } } },
      select: { clientId: true },
      orderBy: { computedAt: "asc" },
      take: limit - ids.length,
    });
    ids.push(...stale.map((s) => s.clientId));
  }
  let refreshed = 0;
  for (const id of ids) {
    try {
      if (await refreshCustomerIntelligence(id)) refreshed += 1;
    } catch (error) {
      console.error("Customer intelligence refresh failed for", id, error);
    }
  }
  return { refreshed };
}
