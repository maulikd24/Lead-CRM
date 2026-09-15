"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { requestApproval } from "@/lib/policy/approvals/service";
import { computeAccrual, COMPUTATION_VERSION, type CommissionRuleInput } from "@/lib/earnings/compute-accruals";
import { buildPayoutRun } from "@/lib/earnings/build-payout-run";

const TXN_SYNC_SOURCE = "txn_sync";

/**
 * Derives BROKERAGE RevenueEvents from Workstream 2's own Transaction.brokerageAmount — the
 * revenue path that needs no CSV at all, since the data already flows in via Households. Upserts
 * by (sourceSystem, externalRef) like every other ingestion path here; safe to click repeatedly as
 * new transactions land.
 */
export async function syncRevenueFromTransactionsAction(): Promise<{ created: number; skipped: number }> {
  await requireRole(["ADMIN", "FINANCE"]);

  const transactions = await prisma.transaction.findMany({
    where: { brokerageAmount: { not: null } },
    include: { tradingAccount: { select: { clientId: true } } },
  });

  let created = 0;
  let skipped = 0;
  for (const txn of transactions) {
    const existing = await prisma.revenueEvent.findUnique({
      where: { sourceSystem_externalRef: { sourceSystem: TXN_SYNC_SOURCE, externalRef: txn.id } },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.revenueEvent.create({
      data: {
        sourceSystem: TXN_SYNC_SOURCE,
        externalRef: txn.id,
        transactionId: txn.id,
        tradingAccountId: txn.tradingAccountId,
        clientId: txn.tradingAccount.clientId,
        revenueType: "BROKERAGE",
        grossRevenueAmount: txn.brokerageAmount!,
        eventDate: txn.transactionDate,
        rawPayload: { transactionId: txn.id, brokerageAmount: Number(txn.brokerageAmount) },
      },
    });
    created++;
  }

  revalidatePath("/earnings");
  return { created, skipped };
}

/**
 * (Re)computes CommissionAccrual rows for every RevenueEvent whose account has a sourcing partner
 * with an active commission plan. Idempotent via the existing
 * @@unique([revenueEventId, partnerProfileId, commissionRuleId]) upsert key; accruals already
 * INCLUDED_IN_PAYOUT (frozen once a run is approved) are left untouched.
 */
export async function recomputeAccrualsAction(): Promise<{ computed: number; skipped: number }> {
  await requireRole(["ADMIN", "FINANCE"]);

  const events = await prisma.revenueEvent.findMany({
    include: {
      transaction: { select: { transactionType: true, product: { select: { category: true } } } },
      tradingAccount: { select: { sourcingPartnerId: true } },
      accruals: { select: { status: true } },
    },
  });

  let computed = 0;
  let skipped = 0;

  for (const event of events) {
    if (event.accruals.some((a) => a.status === "INCLUDED_IN_PAYOUT")) {
      skipped++;
      continue;
    }
    const partnerProfileId = event.tradingAccount?.sourcingPartnerId ?? null;
    if (!partnerProfileId) {
      skipped++;
      continue;
    }

    const assignment = await prisma.partnerCommissionAssignment.findFirst({
      where: {
        partnerProfileId,
        validFrom: { lte: event.eventDate },
        OR: [{ validTo: null }, { validTo: { gt: event.eventDate } }],
      },
      orderBy: { validFrom: "desc" },
    });
    if (!assignment) {
      skipped++;
      continue;
    }

    const rules = await prisma.commissionRule.findMany({
      where: { commissionPlanId: assignment.commissionPlanId },
      include: { slabs: true },
    });
    const ruleInputs: CommissionRuleInput[] = rules.map((r) => ({
      id: r.id,
      productCategory: r.productCategory,
      transactionType: r.transactionType,
      rateType: r.rateType,
      percentRate: r.percentRate !== null ? Number(r.percentRate) : null,
      flatRate: r.flatRate !== null ? Number(r.flatRate) : null,
      validFrom: r.validFrom,
      validTo: r.validTo,
      slabs: r.slabs.map((s) => ({ minAmount: Number(s.minAmount), maxAmount: s.maxAmount !== null ? Number(s.maxAmount) : null, rate: Number(s.rate) })),
    }));

    const result = computeAccrual(
      {
        grossRevenueAmount: Number(event.grossRevenueAmount),
        eventDate: event.eventDate,
        productCategory: event.transaction?.product?.category ?? null,
        transactionType: event.transaction?.transactionType ?? null,
      },
      ruleInputs,
    );
    if (!result) {
      skipped++;
      continue;
    }

    await prisma.commissionAccrual.upsert({
      where: {
        revenueEventId_partnerProfileId_commissionRuleId: {
          revenueEventId: event.id,
          partnerProfileId,
          commissionRuleId: result.commissionRuleId,
        },
      },
      update: { accrualAmount: result.accrualAmount, computationVersion: COMPUTATION_VERSION },
      create: {
        revenueEventId: event.id,
        partnerProfileId,
        commissionRuleId: result.commissionRuleId,
        accrualAmount: result.accrualAmount,
        accrualDate: event.eventDate,
        computationVersion: COMPUTATION_VERSION,
      },
    });
    computed++;
  }

  revalidatePath("/earnings");
  return { computed, skipped };
}

const createPayoutRunSchema = z
  .object({ periodStart: z.string().min(1), periodEnd: z.string().min(1) })
  .transform((v) => ({ periodStart: new Date(v.periodStart), periodEnd: new Date(v.periodEnd) }));

export async function createPayoutRunAction(formData: FormData) {
  const session = await requireRole(["ADMIN", "FINANCE"]);

  const { periodStart, periodEnd } = createPayoutRunSchema.parse({
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
  });
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodStart >= periodEnd) {
    throw new Error("Invalid period range");
  }

  const run = await prisma.payoutRun.create({
    data: { periodStart, periodEnd, createdById: session.user.id },
  });
  await buildPayoutRun(run.id);

  revalidatePath("/earnings");
  return run;
}

/** Recomputes a still-DRAFT run's Payout/PayoutLine rows against the current CommissionAccrual
 * set — lets Finance regenerate after fixing rules/revenue before submitting for approval. */
export async function rebuildPayoutRunAction(payoutRunId: string) {
  await requireRole(["ADMIN", "FINANCE"]);
  await buildPayoutRun(payoutRunId);
  revalidatePath(`/earnings/runs/${payoutRunId}`);
}

export async function submitPayoutRunForApprovalAction(payoutRunId: string): Promise<{ pendingApproval: boolean }> {
  const session = await requireRole(["ADMIN", "FINANCE"]);

  const run = await prisma.payoutRun.findUniqueOrThrow({ where: { id: payoutRunId } });
  if (run.status !== "DRAFT") throw new Error(`PayoutRun is ${run.status}, not DRAFT`);

  await requestApproval(
    "PAYOUT_ADJUSTMENT",
    { entity: "PayoutRun", entityId: payoutRunId, payload: { payoutRunId }, reason: "Payout run submitted for approval" },
    { id: session.user.id, role: session.user.role },
  );
  await prisma.payoutRun.update({ where: { id: payoutRunId }, data: { status: "PENDING_APPROVAL" } });

  revalidatePath(`/earnings/runs/${payoutRunId}`);
  revalidatePath("/earnings");
  return { pendingApproval: true };
}

/** No second approval step — the run was already approved at PENDING_APPROVAL -> APPROVED; this
 * is a bookkeeping close-out (locks the period), not a new financial decision. */
export async function finalizePayoutRunAction(payoutRunId: string) {
  await requireRole(["ADMIN"]);

  const run = await prisma.payoutRun.findUniqueOrThrow({ where: { id: payoutRunId } });
  if (run.status !== "APPROVED") throw new Error(`PayoutRun is ${run.status}, not APPROVED`);

  await prisma.payoutRun.update({ where: { id: payoutRunId }, data: { status: "FINALIZED", finalizedAt: new Date() } });

  revalidatePath(`/earnings/runs/${payoutRunId}`);
  revalidatePath("/earnings");
}

const adjustmentSchema = z.object({
  partnerProfileId: z.string().min(1),
  payoutId: z.string().min(1),
  amount: z.coerce.number(),
  reason: z.string().min(1, "Reason is required"),
});

/** Always routes through maker-checker — never writes a CommissionAdjustment directly. */
export async function requestCommissionAdjustmentAction(input: { partnerProfileId: string; payoutId: string; amount: number; reason: string }) {
  const session = await requireRole(["ADMIN", "FINANCE"]);
  const parsed = adjustmentSchema.parse(input);

  await requestApproval(
    "COMMISSION_ADJUSTMENT",
    { entity: "Payout", entityId: parsed.payoutId, payload: parsed, reason: parsed.reason },
    { id: session.user.id, role: session.user.role },
  );

  revalidatePath(`/earnings/runs`);
}

export async function markPayoutReconciledAction(payoutId: string, externalPayoutRef: string) {
  await requireRole(["ADMIN", "FINANCE"]);

  const payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
  if (payout.status !== "APPROVED") throw new Error(`Payout is ${payout.status}, not APPROVED`);

  await prisma.payout.update({
    where: { id: payoutId },
    data: { status: "RECONCILED_EXTERNALLY", externalPayoutRef, reconciledAt: new Date() },
  });

  revalidatePath("/finance-console");
}
