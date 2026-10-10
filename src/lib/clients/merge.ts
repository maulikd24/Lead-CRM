import type { prisma } from "@/lib/db/prisma";
import { holderConflict } from "@/lib/identity/merge-review/plan";
import { normalizePan } from "@/lib/utils/normalize-contact";

/** The transaction client handed to `prisma.$transaction(async (tx) => ...)` (the app client is extended, so the stock Prisma type does not fit). */
export type MergeTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type MergeSummary = { duplicateId: string; duplicateName: string; conflicts: string[] };

/** A merge that cannot proceed (stale, blocked by a safety rule). The message is safe to show to the user. */
export class MergeBlockedError extends Error {
  constructor(message: string, readonly code: "STALE" | "PAN_MISMATCH" | "HOLDERS" | "SAME" = "STALE") {
    super(message);
    this.name = "MergeBlockedError";
  }
}

export type MergeOptions = {
  /** Refuse when both customers carry different PANs, or only the archived one has a PAN. Used by the review queue. */
  enforcePanGuard?: boolean;
};

/**
 * The one implementation of "merge a duplicate customer into a primary". Everything runs on the caller's transaction client
 * (`prisma.$transaction(tx => mergeClientRecords(tx, ...))`) so the checks and the writes are atomic.
 *
 * Compare-and-set: both rows are locked in id order (no lock-order deadlocks) with a guarded UPDATE, so a concurrent second merge
 * of the same customer waits, then finds it already merged and stops with MergeBlockedError instead of merging twice.
 * Moves documents, tasks, activities, calls, payments, stage history, exceptions, trading accounts (+ revenue events), messages, support tickets and
 * joint holders to the primary; moves a KYC / funding / dealer record only when the primary has none. The duplicate is archived
 * (mergedIntoId, NOT_PROCEEDING), never deleted. Writes an audit entry and a note on the primary's timeline.
 */
export async function mergeClientRecords(
  tx: MergeTx,
  primaryId: string,
  duplicateId: string,
  actorId: string,
  options: MergeOptions = {},
): Promise<MergeSummary> {
  if (primaryId === duplicateId) throw new MergeBlockedError("A customer cannot be merged into itself.", "SAME");

  const live = { mergedIntoId: null, isDeleted: false } as const;
  for (const id of [primaryId, duplicateId].sort()) {
    const locked = await tx.client.updateMany({ where: { id, ...live }, data: { updatedAt: new Date() } });
    if (locked.count !== 1) throw new MergeBlockedError("One of these customers was already merged, archived or removed. Refresh and review again.");
  }

  // Sequential on purpose: one interactive transaction is one connection, which runs one query at a time.
  const primary = await tx.client.findUnique({ where: { id: primaryId }, select: { pan: true } });
  const duplicate = await tx.client.findUnique({ where: { id: duplicateId }, select: { name: true, clientCode: true, pan: true, mobile: true, email: true } });
  const primaryContact = await tx.client.findUnique({ where: { id: primaryId }, select: { mobile: true, email: true } });
  const primaryKycSteps = await tx.kycStep.count({ where: { clientId: primaryId } });
  const duplicateKycSteps = await tx.kycStep.count({ where: { clientId: duplicateId } });
  const primaryKyc = await tx.kycRecord.findUnique({ where: { clientId: primaryId } });
  const duplicateKyc = await tx.kycRecord.findUnique({ where: { clientId: duplicateId } });
  const primaryFunding = await tx.fundingRecord.findUnique({ where: { clientId: primaryId } });
  const duplicateFunding = await tx.fundingRecord.findUnique({ where: { clientId: duplicateId } });
  const primaryDealer = await tx.dealerIntroduction.findUnique({ where: { clientId: primaryId } });
  const duplicateDealer = await tx.dealerIntroduction.findUnique({ where: { clientId: duplicateId } });
  const primaryHolders = await tx.accountHolder.findMany({ where: { clientId: primaryId, isDeleted: false } });
  const duplicateHolders = await tx.accountHolder.findMany({ where: { clientId: duplicateId, isDeleted: false } });

  if (options.enforcePanGuard) {
    const pp = primary?.pan ? normalizePan(primary.pan) : "";
    const pd = duplicate?.pan ? normalizePan(duplicate.pan) : "";
    if (pp && pd && pp !== pd) throw new MergeBlockedError("These customers have different PAN numbers, so they are different legal persons and can never be merged.", "PAN_MISMATCH");
    if (pd && !pp) throw new MergeBlockedError("Keep the record that has the PAN: the archived record's PAN cannot be carried over.", "PAN_MISMATCH");
  }

  // Joint-holder accounts can't be silently merged: reparenting could exceed the 3-holder cap or collide on Second/Third position.
  const holderBlock = holderConflict(primaryHolders, duplicateHolders);
  if (holderBlock) throw new MergeBlockedError(holderBlock, "HOLDERS");

  const reparent = { where: { clientId: duplicateId }, data: { clientId: primaryId } };
  await tx.document.updateMany(reparent);
  await tx.task.updateMany(reparent);
  await tx.activity.updateMany(reparent);
  await tx.deviceCall.updateMany(reparent);
  await tx.clientPayment.updateMany(reparent);
  await tx.stageHistory.updateMany(reparent);
  await tx.exception.updateMany(reparent);
  // TradingAccount has no uniqueness tied to clientId, so it is always safe to reparent. RevenueEvent.clientId is a denormalized copy of the
  // same ownership fact, so it moves in the same pass or it would silently go stale.
  await tx.tradingAccount.updateMany(reparent);
  await tx.revenueEvent.updateMany(reparent);
  // WhatsApp/SMS threads: a merged-away client is hidden from the inbox, so without this its conversation history would disappear.
  await tx.message.updateMany(reparent);
  // Helpdesk tickets follow the person; no uniqueness involves clientId.
  await tx.supportTicket.updateMany(reparent);
  if (duplicateHolders.length > 0) await tx.accountHolder.updateMany(reparent);

  const conflicts: string[] = [];
  // The archived profile drops out of contact matching, so a mobile/email only it held would be lost and the next contact using it would
  // create yet another duplicate. Fill the primary's missing details from it (the identity keys are recomputed by the write extension).
  const contactFill = {
    ...(!primaryContact?.mobile && duplicate?.mobile ? { mobile: duplicate.mobile } : {}),
    ...(!primaryContact?.email && duplicate?.email ? { email: duplicate.email } : {}),
  };
  if (Object.keys(contactFill).length > 0) await tx.client.update({ where: { id: primaryId }, data: contactFill });
  // KYC pipeline steps are unique per client/holder/step, so, like KycRecord, they move only when the primary has none.
  if (duplicateKycSteps > 0) {
    if (primaryKycSteps === 0) await tx.kycStep.updateMany(reparent);
    else conflicts.push("KycStep");
  }
  if (duplicateKyc) {
    if (!primaryKyc) await tx.kycRecord.update({ where: { clientId: duplicateId }, data: { clientId: primaryId } });
    else conflicts.push("KycRecord");
  }
  if (duplicateFunding) {
    if (!primaryFunding) await tx.fundingRecord.update({ where: { clientId: duplicateId }, data: { clientId: primaryId } });
    else conflicts.push("FundingRecord");
  }
  if (duplicateDealer) {
    if (!primaryDealer) await tx.dealerIntroduction.update({ where: { clientId: duplicateId }, data: { clientId: primaryId } });
    else conflicts.push("DealerIntroduction");
  }

  await tx.client.update({ where: { id: duplicateId }, data: { mergedIntoId: primaryId, status: "NOT_PROCEEDING" } });
  await tx.auditLog.create({
    data: { userId: actorId, entity: "Client", entityId: duplicateId, action: "merged", newValue: { mergedIntoId: primaryId, unresolvedConflicts: conflicts } },
  });
  const unresolved = conflicts.length ? ` (unresolved: ${conflicts.join(", ")})` : "";
  await tx.activity.create({
    data: {
      clientId: primaryId,
      userId: actorId,
      type: "NOTE",
      payload: {
        message: duplicate
          ? `Merged duplicate client ${duplicate.name} (${duplicate.clientCode}) into this record${unresolved}`
          : `Merged a duplicate client into this record${unresolved}`,
      },
    },
  });

  return { duplicateId, duplicateName: duplicate?.name ?? duplicateId, conflicts };
}
