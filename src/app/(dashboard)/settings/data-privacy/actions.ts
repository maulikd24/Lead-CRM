"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { requestApproval } from "@/lib/policy/approvals/service";
import { eraseClientTraces } from "@/lib/privacy/erase-client-traces";
import { claimKey } from "@/lib/referrals/attribute";
import { findMergedDuplicates, scrubMergedDuplicate } from "@/lib/privacy/merged-duplicates";

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

    const [tradingAccountCount, householdMemberCount, revenueEventCount, advisoryInteractionCount, paymentCount] = await Promise.all([
      tx.tradingAccount.count({ where: { clientId: { in: ids } } }),
      tx.householdMember.count({ where: { clientId: { in: ids } } }),
      tx.revenueEvent.count({ where: { clientId: { in: ids } } }),
      tx.advisoryInteraction.count({ where: { clientId: { in: ids } } }),
      tx.clientPayment.count({ where: { clientId: { in: ids } } }),
    ]);
    // A PMS/AIF holding that was actually invested or redeemed is a financial record, like a trading account.
    if ((await tx.pmsAifHolding.count({ where: { clientId: { in: ids }, status: { not: "NOT_INVESTED" } } })) > 0) throw new Error("This client has PMS/AIF holdings on file — use Archive instead of permanent deletion.");
    if (tradingAccountCount > 0) throw new Error("This client has Trading Accounts on file — use Archive instead of permanent deletion.");
    if (householdMemberCount > 0) throw new Error("This client belongs to a Household — use Archive instead of permanent deletion.");
    if (revenueEventCount > 0) throw new Error("This client has Revenue Events on file — use Archive instead of permanent deletion.");
    if (paymentCount > 0) throw new Error("This client has Payments on file — use Archive instead of permanent deletion.");
    if (advisoryInteractionCount > 0) throw new Error("This client has Advisory Interactions on file — use Archive instead of permanent deletion.");

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

    // Delete every Restrict-FK child in dependency order, then the Client row itself.
    await tx.journeyRunStep.deleteMany({ where: { run: { clientId: { in: ids } } } });
    await tx.journeyRun.deleteMany({ where: { clientId: { in: ids } } });
    await tx.agentProposal.deleteMany({ where: { clientId: { in: ids } } }); // RESTRICT FK; messageId is a plain string, so no ordering dependency on Message
    await tx.cleverTapSync.deleteMany({ where: { clientId: { in: ids } } }); // RESTRICT FK would block the Client delete
    await tx.mergeSuggestion.deleteMany({ where: { OR: [{ clientAId: { in: ids } }, { clientBId: { in: ids } }] } }); // RESTRICT FKs (either side of the pair) would block the Client delete
    await tx.consentRecord.deleteMany({ where: { clientId: { in: ids } } }); // RESTRICT FK would block the Client delete (an append-only ledger still allows DELETE, for erasure)
    // Referral programme. Referrer.clientId is a RESTRICT FK: the person's referrer record, its codes and everything they referred go first. The person's own
    // "referred by" row goes too. Reward ledger and statement rows hold only plain ids and amounts (no personal data) and stay as anonymous financial records.
    const referrerIds = (await tx.referrer.findMany({ where: { clientId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    await tx.referralDevice.deleteMany({ where: { clientId: { in: ids } } }); // hashed devices (also cascade on the Client delete)
    await tx.referral.deleteMany({ where: { OR: [{ referredClientId: { in: ids } }, ...(referrerIds.length ? [{ referrerId: { in: referrerIds } }] : [])] } }); // events cascade
    await tx.referralCode.deleteMany({ where: { referrerId: { in: referrerIds } } });
    await tx.referrer.deleteMany({ where: { clientId: { in: ids } } });
    // Profiling and conversation-analysis rows (RESTRICT FKs; they quote the person). ConversationReview points at Task and Activity, so it goes before them.
    await tx.conversationReview.deleteMany({ where: { clientId: { in: ids } } });
    await tx.conversationInsight.deleteMany({ where: { clientId: { in: ids } } });
    await tx.interactionOutcome.deleteMany({ where: { clientId: { in: ids } } });
    await tx.customerIntelligence.deleteMany({ where: { clientId: { in: ids } } });
    await tx.smartAllvestProfile.deleteMany({ where: { clientId: { in: ids } } });
    await tx.segmentMembership.deleteMany({ where: { clientId: { in: ids } } });
    await tx.assetClassAcceptance.deleteMany({ where: { clientId: { in: ids } } });
    await tx.wealthHealthCheckup.deleteMany({ where: { clientId: { in: ids } } });
    await tx.pmsAifHolding.deleteMany({ where: { clientId: { in: ids } } }); // NOT_INVESTED placeholders only: an invested/redeemed holding already blocked the erasure above
    await tx.opportunityStageHistory.deleteMany({ where: { opportunity: { clientId: { in: ids } } } });
    await tx.opportunity.deleteMany({ where: { clientId: { in: ids } } });
    await tx.message.deleteMany({ where: { clientId: { in: ids } } });
    await tx.document.deleteMany({ where: { clientId: { in: ids } } });
    await tx.kycStep.deleteMany({ where: { clientId: { in: ids } } });
    await tx.supportTicket.deleteMany({ where: { clientId: { in: ids } } });
    await tx.accountHolder.deleteMany({ where: { clientId: { in: ids } } });
    await tx.task.deleteMany({ where: { clientId: { in: ids } } });
    await tx.deviceCall.deleteMany({ where: { clientId: { in: ids } } });
    await tx.activity.deleteMany({ where: { clientId: { in: ids } } });
    await tx.stageHistory.deleteMany({ where: { clientId: { in: ids } } });
    await tx.exception.deleteMany({ where: { clientId: { in: ids } } });
    await tx.kycRecord.deleteMany({ where: { clientId: { in: ids } } });
    await tx.fundingRecord.deleteMany({ where: { clientId: { in: ids } } });
    await tx.dealerIntroduction.deleteMany({ where: { clientId: { in: ids } } });
    await tx.client.delete({ where: { id: clientId } });
    for (const duplicate of duplicates) await scrubMergedDuplicate(tx, duplicate.id);

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
