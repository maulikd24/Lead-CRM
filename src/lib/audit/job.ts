/**
 * The scheduled quality-audit job, run from the cron tick. Gated by QUALITY_AUDIT_ENABLED (off unless "1", as in finding-store.ts).
 *
 * Two passes, each isolated so one cannot stop the other:
 * 1. Deterministic: loads stored commitments and complaints, runs the three detectors and records the findings.
 * 2. AI-assisted: runs the four AI detectors over recent stored conversations (WhatsApp threads and calls). Skipped when no
 *    Anthropic key is set. Each conversation scanned is marked in the audit log so it is not paid for again on the next tick.
 *
 * Idempotent: findings are unique on dedupeKey, so a rerun stores nothing new. Logs carry counts only, never record text.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { isAnthropicConfigured } from "@/lib/ai/gateway/config";

import { type CommitmentRecord, type ComplaintRecord, detectFindings, type FindingDraft } from "./findings";
import { type FindingDbPort, qualityAuditEnabled, recordFindings } from "./finding-store";
import { type CallFn, type DetectorOutcome, type ReviewText, runAiDetectors } from "./ai-detectors";

export const SCANNED_ACTION = "quality_audit.ai_scanned";
const LOAD_LIMIT = 5000;
const REVIEW_WINDOW_MS = 24 * 3_600_000;
const REVIEW_LOAD_LIMIT = 50;
export const MAX_REVIEWS_PER_RUN = 10;
/** Stop starting new conversations after this long, so the AI pass stays inside the tick's time limit. */
export const AI_TIME_BUDGET_MS = 120_000;

export type StoredRecords = { commitments: CommitmentRecord[]; complaints: ComplaintRecord[] };
export type ReviewWindow = { markerUserId: string | null; reviews: ReviewText[] };

export type QualityAuditInput = {
  env?: Record<string, string | undefined>;
  now?: Date;
  loadRecords?: () => Promise<StoredRecords>;
  port?: FindingDbPort;
  hasKey?: boolean;
  loadReviews?: (now: Date) => Promise<ReviewWindow>;
  call?: CallFn;
  markScanned?: (markerUserId: string, reviewIds: string[], now: Date) => Promise<void>;
  /** Clock for the time budget (tests inject one). */
  clock?: () => number;
};

export type QualityAuditResult = {
  deterministic: { recordsLoaded: number; attempted: number; created: number };
  ai: { skipped: string } | { skipped?: undefined; reviewsSeen: number; scanned: number; drafted: number; created: number; counts: Record<DetectorOutcome, number> };
};

const errorName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

/** Loads the stored records the deterministic detectors read. Open commitments and kept ones; open complaints. */
export async function loadStoredRecords(): Promise<StoredRecords> {
  const { prisma } = await import("@/lib/db/prisma");
  const [commitments, complaints] = await Promise.all([
    prisma.commitment.findMany({
      where: { confirmedAt: { not: null }, status: { in: ["OPEN", "KEPT"] } },
      select: { id: true, clientId: true, ownerId: true, status: true, dueAt: true, keptAt: true, confirmedAt: true },
      orderBy: { dueAt: "asc" },
      take: LOAD_LIMIT,
    }),
    prisma.complaint.findMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS", "REOPENED"] }, resolvedAt: null, closedAt: null },
      select: { id: true, clientId: true, ownerId: true, severity: true, status: true, slaDueAt: true, resolvedAt: true, closedAt: true },
      orderBy: { slaDueAt: "asc" },
      take: LOAD_LIMIT,
    }),
  ]);
  return { commitments, complaints };
}

/**
 * Recent stored conversations that no AI pass has scanned yet. The marker user is the system actor (the audit row needs a real
 * user); when it is not seeded, the AI pass is skipped rather than paying for calls it cannot record.
 */
export async function loadRecentReviews(now: Date): Promise<ReviewWindow> {
  const { prisma } = await import("@/lib/db/prisma");
  const { SYSTEM_ACTOR_EMAIL } = await import("@/lib/system/system-actor");
  const system = await prisma.user.findUnique({ where: { email: SYSTEM_ACTOR_EMAIL }, select: { id: true } });
  const rows = await prisma.conversationReview.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - REVIEW_WINDOW_MS) }, transcript: { not: null }, status: { not: "PENDING_TRANSCRIPT" } },
    orderBy: { createdAt: "desc" },
    take: REVIEW_LOAD_LIMIT,
    select: { id: true, clientId: true, sourceType: true, assignedRmId: true, transcript: true },
  });
  const ids = rows.map((r) => r.id);
  const scanned = ids.length
    ? await prisma.auditLog.findMany({ where: { action: SCANNED_ACTION, entity: "ConversationReview", entityId: { in: ids } }, select: { entityId: true } })
    : [];
  const done = new Set(scanned.map((s) => s.entityId));
  const reviews = rows
    .filter((r) => !done.has(r.id) && (r.transcript ?? "").trim().length > 0)
    .slice(0, MAX_REVIEWS_PER_RUN)
    .map((r) => ({ id: r.id, clientId: r.clientId, sourceType: r.sourceType as "CALL" | "WHATSAPP_THREAD", assignedRmId: r.assignedRmId, transcript: r.transcript ?? "" }));
  return { markerUserId: system?.id ?? null, reviews };
}

/** Writes one audit row per conversation that was scanned. Counts and categories only; no text. */
export async function markScanned(markerUserId: string, reviewIds: string[], now: Date): Promise<void> {
  if (reviewIds.length === 0) return;
  const { prisma } = await import("@/lib/db/prisma");
  await prisma.auditLog.createMany({
    data: reviewIds.map((id) => ({
      userId: markerUserId,
      entity: "ConversationReview",
      entityId: id,
      action: SCANNED_ACTION,
      newValue: { detectors: 4 },
      reason: null,
      timestamp: now,
    })),
  });
}

async function defaultPort(): Promise<FindingDbPort> {
  const { prisma } = await import("@/lib/db/prisma");
  const { prismaFindingPort } = await import("./finding-store.prisma");
  // The app's extended client has the same delegates; the cast only matches the adapter's declared parameter type.
  return prismaFindingPort(prisma as unknown as PrismaClient);
}

async function defaultCall(input: Parameters<CallFn>[0]) {
  const { callModel } = await import("@/lib/ai/gateway");
  return callModel(input);
}

export async function runQualityAuditJob(i: QualityAuditInput = {}): Promise<QualityAuditResult | { skipped: string }> {
  const env = i.env ?? process.env;
  if (!qualityAuditEnabled(env)) return { skipped: "flag off" };
  const now = i.now ?? new Date();
  const clock = i.clock ?? (() => Date.now());
  const started = clock();

  // Pass 1: deterministic. Its own failure is logged by name and does not stop the AI pass.
  let deterministic: QualityAuditResult["deterministic"] = { recordsLoaded: 0, attempted: 0, created: 0 };
  try {
    const records = await (i.loadRecords ?? loadStoredRecords)();
    const drafts: FindingDraft[] = detectFindings({ commitments: records.commitments, complaints: records.complaints }, now);
    const port = i.port ?? (await defaultPort());
    const stored = await recordFindings(drafts, port, env);
    deterministic = { recordsLoaded: records.commitments.length + records.complaints.length, attempted: stored.attempted, created: stored.created };
  } catch (error) {
    console.error(JSON.stringify({ event: "quality_audit_deterministic_failed", error: errorName(error) }));
  }

  // Pass 2: AI-assisted. Skipped (not failed) without a key.
  const hasKey = i.hasKey ?? isAnthropicConfigured(env);
  let ai: QualityAuditResult["ai"];
  if (!hasKey) {
    ai = { skipped: "no_ai_key" };
  } else {
    try {
      const window = await (i.loadReviews ?? loadRecentReviews)(now);
      if (!window.markerUserId) {
        ai = { skipped: "no_system_actor" };
      } else {
        const batch = await runAiDetectors({
          reviews: window.reviews,
          call: i.call ?? defaultCall,
          hasKey: true,
          now,
          shouldStop: () => clock() - started > AI_TIME_BUDGET_MS,
        });
        if (batch.skipped) {
          ai = { skipped: batch.skipped };
        } else {
          const port = i.port ?? (await defaultPort());
          const stored = await recordFindings(batch.drafts, port, env);
          await (i.markScanned ?? markScanned)(window.markerUserId, batch.scannedReviewIds, now);
          ai = { reviewsSeen: batch.reviewsSeen, scanned: batch.scannedReviewIds.length, drafted: batch.drafts.length, created: stored.created, counts: batch.counts };
        }
      }
    } catch (error) {
      ai = { skipped: `error:${errorName(error)}` };
      console.error(JSON.stringify({ event: "quality_audit_ai_failed", error: errorName(error) }));
    }
  }

  const result: QualityAuditResult = { deterministic, ai };
  console.log(JSON.stringify({ event: "quality_audit_run", deterministic, ai }));
  return result;
}
