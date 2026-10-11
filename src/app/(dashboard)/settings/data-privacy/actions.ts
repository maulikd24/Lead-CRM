"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { requestApproval } from "@/lib/policy/approvals/service";
import { eraseClientTraces } from "@/lib/privacy/erase-client-traces";
import { claimKey } from "@/lib/referrals/attribute";
import { findMergedDuplicates, scrubMergedDuplicate } from "@/lib/privacy/merged-duplicates";
import { legacyAssertErasable, legacyDeleteChildren } from "@/lib/privacy/erasure-legacy";
import { registryAssertErasable, registryDeleteChildren, registryErasureEnabled } from "@/lib/relationships/erase";
import { eraseEventTraces } from "@/lib/events/erase";
import { emitEventInTx } from "@/lib/events/emit-db";
import { dedupeKeyOf } from "@/lib/events/envelope";

const createPolicySchema = z.object({
  entity: z.string().min(1),
  retentionDays: z.coerce.number().int().positive(),
  action: z.enum(["ARCHIVE", "ANONYMIZE", "DELETE"]),
});

export async function createRetentionPolicyAction(formData: FormData) {
  await requireRole(["ADMIN"]);
  const parsed = createPolicySchema.parse({
    entity: formData.get("entity"),
    retentionDays: formData.get("retentionDays"),
    action: formData.get("action"),
  });
  await prisma.dataRetentionPolicy.create({ data: parsed });
  revalidatePath("/settings/data-privacy");
}

export async function togglePolicyActiveAction(policyId: string, isActive: boolean) {
  await requireRole(["ADMIN"]);
  await prisma.dataRetentionPolicy.update({ where: { id: policyId }, data: { isActive } });
  revalidatePath("/settings/data-privacy");
}

const createErasureSchema = z.object({
  subjectType: z.enum(["Client", "PartnerProfile"]),
  subjectId: z.string().min(1),
  notes: z.string().optional(),
});

/** Creates the ErasureRequest, then immediately routes it through the maker-checker engine —
 * approving it only flips its status (see erasure-request.ts's definition); it never
 * auto-executes a deletion. */
export async function createErasureRequestAction(formData: FormData) {
  const session = await requireRole(["ADMIN", "FINANCE"]);
  const parsed = createErasureSchema.parse({
    subjectType: formData.get("subjectType"),
    subjectId: formData.get("subjectId"),
    notes: formData.get("notes") || undefined,
  });

  const erasureRequest = await prisma.erasureRequest.create({
    data: { subjectType: parsed.subjectType, subjectId: parsed.subjectId, requestedById: session.user.id, notes: parsed.notes },
  });

  const approvalRequest = await requestApproval(
    "ERASURE_REQUEST",
    { entity: "ErasureRequest", entityId: erasureRequest.id, payload: { erasureRequestId: erasureRequest.id }, reason: parsed.notes },
    { id: session.user.id, role: session.user.role },
  );

  await prisma.erasureRequest.update({ where: { id: erasureRequest.id }, data: { approvalRequestId: approvalRequest.id } });

  revalidatePath("/settings/data-privacy");
  revalidatePath("/settings/approval-workflows");
  if (parsed.subjectType === "Client") revalidatePath(`/clients/${parsed.subjectId}`);
}

/**
 * The step erasure-request.ts's apply() deliberately never does — actually deleting data.
 * Admin-only, and only proceeds once the request has already cleared maker-checker approval.
 * Refuses outright if the client has any financial/regulatory trail (TradingAccount,
 * HouseholdMember, RevenueEvent, AdvisoryInteraction) — that data must never silently disappear
 * or get orphaned; Archive remains the answer for those clients. The safety check re-runs INSIDE
 * the transaction (not just before it), so a race with data added between approval and execution
 * still blocks correctly.
 */
export async function executeClientErasureAction(erasureRequestId: string) {
  const session = await requireRole(["ADMIN"]);

  const erasureRequest = await prisma.erasureRequest.findUniqueOrThrow({ where: { id: erasureRequestId } });
  if (erasureRequest.subjectType !== "Client") throw new Error("Only Client erasure requests can be executed here");
  if (erasureRequest.status !== "APPROVED") throw new Error(`Erasure request is ${erasureRequest.status}, not APPROVED`);

  const clientId = erasureRequest.subjectId;

  await prisma.$transaction(async (tx) => {
    // Duplicates merged into this customer (directly or through a chain) are separate Client rows that keep the same person's
    // details. Their children are removed with the customer's, and their personal fields are scrubbed (the rows stay as anchors).
    const duplicates = await findMergedDuplicates(tx, clientId);
    const ids = [clientId, ...duplicates.map((d) => d.id)];

    // Financial and regulatory trails block the erasure. The original checks (erasure-legacy.ts) or the registry-driven ones (RELATIONSHIP_REGISTRY_ERASURE=1): same rule, same messages.
    if (registryErasureEnabled()) await registryAssertErasable(tx, ids);
    else await legacyAssertErasable(tx, ids);

    const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        entity: "Client",
        entityId: clientId,
        action: "permanently_deleted",
        // AuditLog is append-only, so this row outlives the erasure — keep only masked identifiers.
        oldValue: {
          clientCode: client.clientCode,
          pan: maskTail(client.pan, 4),
          mobile: maskTail(client.mobile, 4),
          email: client.email ? "[erased]" : null,
          ...(duplicates.length > 0 ? { scrubbedMergedDuplicates: duplicates.map((d) => d.clientCode) } : {}),
        },
        reason: erasureRequest.notes,
      },
    });

    // Signup/lead ledger rows, notifications naming the client and merge notes: scrubbed to a tombstone, not left holding the person's data.
    // Referral programme: claims keyed by this person's app user id (hashed) are removed before the ledger rows are tombstoned.
    const appSignups = await tx.leadIntake.findMany({ where: { source: "allvest_app", clientId: { in: ids } }, select: { externalId: true } });
    if (appSignups.length) await tx.referral.deleteMany({ where: { idempotencyKey: { in: appSignups.map((s) => claimKey(s.externalId)) } } });
    await eraseClientTraces(tx, client);
    for (const duplicate of duplicates) await eraseClientTraces(tx, duplicate);

    // Delete every Restrict-FK child in dependency order, then the Client row itself. Original steps or registry-driven (same flag).
    if (registryErasureEnabled()) await registryDeleteChildren(tx, ids);
    else {
      await legacyDeleteChildren(tx, ids);
      await eraseEventTraces(tx, ids); // the event tables are new: no legacy step, so the legacy path calls the same helper
    }
    await tx.client.delete({ where: { id: clientId } });
    for (const duplicate of duplicates) await scrubMergedDuplicate(tx, duplicate.id);

    // The fact that the customer was erased (flagged off by default, never throws): earlier events of this customer keep only id, type and times.
    await emitEventInTx(tx, { type: "customer.erased", actor: { type: "user", id: session.user.id }, clientId, source: "crm.web", dedupeKey: dedupeKeyOf("crm.web", erasureRequestId, "customer.erased"), metadata: { mergedDuplicates: duplicates.length } });

    await tx.erasureRequest.update({ where: { id: erasureRequestId }, data: { status: "COMPLETED", completedAt: new Date() } });
  });

  revalidatePath("/settings/data-privacy");
  revalidatePath("/clients");
}

/** "ABCDE1234F" → "******234F": enough to reconcile against an offline record, not enough to re-identify. */
function maskTail(value: string | null, visible: number): string | null {
  if (!value) return null;
  return "*".repeat(Math.max(0, value.length - visible)) + value.slice(-visible);
}
