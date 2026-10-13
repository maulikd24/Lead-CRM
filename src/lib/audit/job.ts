/**
 * The scheduled quality-audit job, run from the cron tick. Gated by QUALITY_AUDIT_ENABLED (off unless "1", as in finding-store.ts).
 *
 * Two passes, each isolated so one cannot stop the other:
 * 1. Deterministic: loads stored commitments and complaints, runs the three detectors and records the findings.
 * 2. AI-assisted: runs the four AI detectors over recent stored conversations (WhatsApp threads and calls). Skipped when no
 *    Anthropic key is set, and in production when no daily budget is set for audit.flags (skipped: "no_budget", no call made).
 *    Each conversation that is final is marked in the audit log, in the same transaction as its findings, so it is not paid
 *    for again on the next tick.
 *
 * Idempotent: findings are unique on dedupeKey, so a rerun stores nothing new. Logs carry counts only, never record text.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { isAnthropicConfigured, isProduction } from "@/lib/ai/gateway/config";
import { budgetFor } from "@/lib/ai/gateway/gateway";

import { type CommitmentRecord, type ComplaintRecord, detectFindings, type FindingDraft } from "./findings";
import { type FindingDbPort, qualityAuditEnabled, recordFindings } from "./finding-store";
import { AI_PURPOSE_ID, type CallFn, type DetectorOutcome, type ReviewText, runAiDetectors } from "./ai-detectors";
import { type AiCommitDb, type AiCommitInput, commitAiBatch, SCANNED_ACTION, SCHEMA_FAILED_ACTION } from "./ai-commit";

export { SCANNED_ACTION };
const LOAD_LIMIT = 5000;
/** Chat threads are read for a day after they arrive. A call transcript can arrive late (Exotel's callback), so calls get a week. */
export const WHATSAPP_WINDOW_MS = 24 * 3_600_000;
export const CALL_WINDOW_MS = 7 * 24 * 3_600_000;
export const MAX_REVIEWS_PER_RUN = 10;
/** Stop starting new conversations after this long, so the AI pass stays inside the tick's time limit. */
export const AI_TIME_BUDGET_MS = 120_000;

export type StoredRecords = { commitments: CommitmentRecord[]; complaints: ComplaintRecord[] };
export type ReviewWindow = { markerUserId: string | null; reviews: ReviewText[] };

/** The database calls the review loader makes. The app's Prisma client has them; tests pass an in-memory one. */
export type ReviewLoaderDb = {
  user: { findUnique(args: { where: { email: string }; select: { id: true } }): Promise<{ id: string } | null> };
  auditLog: { findMany(args: { where: Record<string, unknown>; select: { entityId: true } }): Promise<{ entityId: string }[]> };
  conversationReview: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: { createdAt: "desc" };
      take: number;
      select: { id: true; clientId: true; sourceType: true; assignedRmId: true; transcript: true };
    }): Promise<{ id: string; clientId: string; sourceType: string; assignedRmId: string | null; transcript: string | null }[]>;
  };
};

export type QualityAuditInput = {
  env?: Record<string, string | undefined>;
  now?: Date;
  loadRecords?: () => Promise<StoredRecords>;
  port?: FindingDbPort;
  hasKey?: boolean;
  loadReviews?: (now: Date) => Promise<ReviewWindow>;
  call?: CallFn;
  /** Writes one AI pass's findings and markers in one transaction. Tests inject a fake; production uses commitAiBatch. */
  commitAi?: (input: AiCommitInput) => Promise<number>;
  /** Database handle for the review loader and the AI commit (tests inject a fake). */
  reviewDb?: ReviewLoaderDb;
  /** Clock for the time budget (tests inject one). */
  clock?: () => number;
};

export type QualityAuditResult = {
  deterministic: { recordsLoaded: number; attempted: number; created: number };
  ai: { skipped: string } | { skipped?: undefined; reviewsSeen: number; scanned: number; drafted: number; created: number; schemaFailures: number; counts: Record<DetectorOutcome, number> };
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
 * Recent stored conversations that no AI pass has scanned yet. Already-scanned reviews are excluded in the query itself, so the
 * newest 10 unscanned ones are always returned, however many scanned ones are newer. Each window is measured on createdAt:
 * a WhatsApp thread for a day, a CALL for a week (its transcript may arrive late). The marker user is the system actor (the
 * audit row needs a real user); when it is not seeded, the AI pass is skipped rather than paying for calls it cannot record.
 */
export async function loadRecentReviews(now: Date, db?: ReviewLoaderDb): Promise<ReviewWindow> {
  const client = db ?? (await defaultReviewDb());
  const { SYSTEM_ACTOR_EMAIL } = await import("@/lib/system/system-actor-email");
  const system = await client.user.findUnique({ where: { email: SYSTEM_ACTOR_EMAIL }, select: { id: true } });
  const widest = new Date(now.getTime() - CALL_WINDOW_MS);
  const markers = await client.auditLog.findMany({
    where: { action: SCANNED_ACTION, entity: "ConversationReview", timestamp: { gte: widest } },
    select: { entityId: true },
  });
  const rows = await client.conversationReview.findMany({
    where: {
      transcript: { not: null },
      status: { not: "PENDING_TRANSCRIPT" },
      id: { notIn: [...new Set(markers.map((m) => m.entityId))] },
      OR: [
        { sourceType: "WHATSAPP_THREAD", createdAt: { gte: new Date(now.getTime() - WHATSAPP_WINDOW_MS) } },
        { sourceType: "CALL", createdAt: { gte: widest } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: MAX_REVIEWS_PER_RUN,
    select: { id: true, clientId: true, sourceType: true, assignedRmId: true, transcript: true },
  });
  const ids = rows.map((r) => r.id);
  const failures = ids.length
    ? await client.auditLog.findMany({ where: { action: SCHEMA_FAILED_ACTION, entity: "ConversationReview", entityId: { in: ids } }, select: { entityId: true } })
    : [];
  const priorFailures = new Map<string, number>();
  for (const f of failures) priorFailures.set(f.entityId, (priorFailures.get(f.entityId) ?? 0) + 1);
  const reviews: ReviewText[] = rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    sourceType: r.sourceType as "CALL" | "WHATSAPP_THREAD",
    assignedRmId: r.assignedRmId,
    transcript: r.transcript ?? "",
    schemaFailures: priorFailures.get(r.id) ?? 0,
  }));
  return { markerUserId: system?.id ?? null, reviews };
}

async function defaultReviewDb(): Promise<ReviewLoaderDb> {
  const { prisma } = await import("@/lib/db/prisma");
  return prisma as unknown as ReviewLoaderDb;
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

async function defaultCommit(input: AiCommitInput): Promise<number> {
  const { prisma } = await import("@/lib/db/prisma");
  return commitAiBatch(prisma as unknown as AiCommitDb, input);
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

  // Pass 2: AI-assisted. Skipped (not failed) without a key, and in production without a daily budget for audit.flags.
  // The budget is checked before any review is loaded, so no model call can be made without one.
  const hasKey = i.hasKey ?? isAnthropicConfigured(env);
  let ai: QualityAuditResult["ai"];
  if (!hasKey) {
    ai = { skipped: "no_ai_key" };
  } else if (isProduction(env) && budgetFor(AI_PURPOSE_ID, env) === null) {
    ai = { skipped: "no_budget" };
  } else {
    try {
      const window = await (i.loadReviews ?? ((t) => loadRecentReviews(t, i.reviewDb)))(now);
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
          const created = await (i.commitAi ?? defaultCommit)({
            drafts: batch.drafts,
            scannedReviewIds: batch.scannedReviewIds,
            schemaFailures: batch.schemaFailures,
            markerUserId: window.markerUserId,
            now,
          });
          ai = { reviewsSeen: batch.reviewsSeen, scanned: batch.scannedReviewIds.length, drafted: batch.drafts.length, created, schemaFailures: batch.schemaFailures.length, counts: batch.counts };
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
