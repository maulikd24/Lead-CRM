/**
 * Writes one AI pass's results in a single transaction: the findings, the "scanned" marker for each review that is final, and a
 * "schema failed" row for each malformed reply. If any write fails, none of them is kept, so a review is never marked scanned
 * without its findings, and a malformed reply is never counted without being recorded.
 *
 * The audit log is append-only (database triggers, hash chain), so every row here is an insert.
 */
import type { PrismaClient } from "@/generated/prisma/client";

import { prismaFindingPort } from "./finding-store.prisma";
import { type FindingDraft, uniqueByKey } from "./findings";

export const SCANNED_ACTION = "quality_audit.ai_scanned";
export const SCHEMA_FAILED_ACTION = "quality_audit.ai_schema_failed";

export type AiCommitInput = {
  drafts: readonly FindingDraft[];
  scannedReviewIds: readonly string[];
  schemaFailures: readonly { reviewId: string; attempt: number }[];
  markerUserId: string;
  now: Date;
};

/** The database handle the commit needs: an interactive transaction. The app's Prisma client has it. */
export type AiCommitDb = { $transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> };

/** Returns how many findings were inserted. */
export async function commitAiBatch(db: AiCommitDb, input: AiCommitInput): Promise<number> {
  return db.$transaction(async (tx) => {
    const rows = uniqueByKey(input.drafts);
    const created = rows.length === 0 ? 0 : await prismaFindingPort(tx).insertIfAbsent(rows);
    if (input.scannedReviewIds.length > 0) {
      await tx.auditLog.createMany({
        data: input.scannedReviewIds.map((id) => ({
          userId: input.markerUserId,
          entity: "ConversationReview",
          entityId: id,
          action: SCANNED_ACTION,
          newValue: { detectors: 4 },
          reason: null,
          timestamp: input.now,
        })),
      });
    }
    if (input.schemaFailures.length > 0) {
      await tx.auditLog.createMany({
        data: input.schemaFailures.map((f) => ({
          userId: input.markerUserId,
          entity: "ConversationReview",
          entityId: f.reviewId,
          action: SCHEMA_FAILED_ACTION,
          newValue: { attempt: f.attempt },
          reason: null,
          timestamp: input.now,
        })),
      });
    }
    return created;
  });
}
