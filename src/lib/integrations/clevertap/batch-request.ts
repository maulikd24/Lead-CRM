import { basePrisma } from "@/lib/db/prisma";
import { consentEnforced } from "@/lib/consent/enforce";
import { coarseMarketingWhere } from "@/lib/consent/coarse";
import type { Actor } from "@/lib/policy/types";
import { requestApproval } from "@/lib/policy/approvals/service";
import { prismaSelectDb, selectBatch } from "./select-batch";
import { loadLiveTarget } from "./push-batch";
import { CLEVERTAP_BATCH_ACTION, CLEVERTAP_BATCH_ENTITY, batchHash, batchPayload, hasOpenBatch, recentBatchRequests, type BatchApprovalDb } from "./push-approval";

export const PUSH_BATCH_LIMIT = 25;

/**
 * An Admin asks for a CleverTap batch. The customers selected now (same rules as the push) and their region are frozen into the
 * request. A different Admin approves it; the push tick then sends exactly that list once. Only one batch may be open at a time.
 */
export async function requestCleverTapPushBatch(actor: Actor, limit = PUSH_BATCH_LIMIT) {
  const target = await loadLiveTarget();
  if (!target) throw new Error("CleverTap is not live on the India region, so there is no batch to approve.");
  const region = target.region ?? "";
  const db = basePrisma as unknown as BatchApprovalDb;

  if (hasOpenBatch(await recentBatchRequests(db))) {
    throw new Error("A CleverTap batch is already waiting for approval or approved and not yet sent.");
  }

  const consent = consentEnforced();
  const ids = await selectBatch(prismaSelectDb(basePrisma), limit, { marketingEvidence: consent && coarseMarketingWhere() !== undefined });
  if (ids.length === 0) throw new Error("No customers are ready for a CleverTap batch right now.");

  const approval = await requestApproval(
    CLEVERTAP_BATCH_ACTION,
    {
      entity: CLEVERTAP_BATCH_ENTITY,
      entityId: batchHash(region, ids),
      payload: batchPayload(region, ids),
      reason: `CleverTap push batch: ${ids.length} customers, region ${region || "default"}`,
    },
    actor,
  );
  return { requestId: approval.id, count: ids.length, region };
}
