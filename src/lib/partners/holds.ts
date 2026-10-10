import type { Role } from "@/generated/prisma/client";
import { ApprovalBlockedError } from "@/lib/policy/approvals/service";
import type { ApprovalDecisionOptions } from "@/lib/policy/approvals/registry";
import type { Actor } from "@/lib/policy/types";
import { parseUnits } from "./native/money";

/**
 * Hold rules for approving a payout run. A run is BLOCKED while any partner who is owed (or owes) money is suspended or
 * terminated, or has no verified bank account, unless an Admin approves with a typed reason, which is audited. Pure rules
 * first (findPayoutHolds, evaluateHolds), then the one database read and the audit write (checkPayoutRunHolds).
 */
export type HoldInput = { partnerId: string; code: string; name: string; status: string; bankVerified: boolean; net: string };
export type Hold = { partnerId: string; code: string; reasons: string[] };

export function findPayoutHolds(partners: HoldInput[]): Hold[] {
  const holds: Hold[] = [];
  for (const p of partners) {
    if (parseUnits(p.net) === BigInt(0)) continue; // nothing to pay or recover: no bank needed
    const reasons: string[] = [];
    if (p.status === "SUSPENDED") reasons.push("Partner is suspended");
    if (p.status === "TERMINATED") reasons.push("Partner is terminated");
    if (!p.bankVerified) reasons.push("Bank account is not verified");
    if (reasons.length) holds.push({ partnerId: p.partnerId, code: p.code, reasons });
  }
  return holds;
}

export const MIN_OVERRIDE_REASON = 10;
export const MAX_OVERRIDE_REASON = 500;

export type HoldDecision = { allow: true; overridden: false } | { allow: true; overridden: true; reason: string } | { allow: false; reasons: string[] };

export function evaluateHolds(input: { holds: Hold[]; role: Role; overrideReason?: string }): HoldDecision {
  if (input.holds.length === 0) return { allow: true, overridden: false };
  const lines = input.holds.flatMap((h) => h.reasons.map((r) => `${h.code}: ${r}`));
  const reason = input.overrideReason?.trim() ?? "";
  if (!reason) return { allow: false, reasons: lines };
  if (input.role !== "ADMIN") return { allow: false, reasons: [...lines, "Only an administrator can override a hold."] };
  if (reason.length < MIN_OVERRIDE_REASON) return { allow: false, reasons: [...lines, `Type a reason of at least ${MIN_OVERRIDE_REASON} characters to override.`] };
  if (reason.length > MAX_OVERRIDE_REASON) return { allow: false, reasons: [...lines, `The reason is too long (${MAX_OVERRIDE_REASON} characters at most).`] };
  return { allow: true, overridden: true, reason };
}

type Dec = { toFixed(): string };
export type HoldDb = {
  payout: {
    findMany(a: { where: { payoutRunId: string }; select: unknown; take: number }): Promise<{ netPayableAmount: Dec; partnerProfile: { id: string; partnerCode: string; empanelmentStatus: string; bankVerifiedAt: Date | null; user: { name: string } } }[]>;
  };
  auditLog: { create(a: { data: Record<string, unknown> }): Promise<unknown> };
};

/** Upper bound on the payouts of one run that are checked. A run larger than this is refused rather than checked partially. */
const MAX_RUN_PAYOUTS = 20000;

/** The approval precheck for a payout run: throws ApprovalBlockedError (the request stays pending) or, for an Admin's typed override, audits it and lets the approval go ahead. */
export async function checkPayoutRunHolds(db: HoldDb, payoutRunId: string, ctx: { actor: Actor; options?: ApprovalDecisionOptions }): Promise<void> {
  const rows = await db.payout.findMany({
    where: { payoutRunId },
    select: { netPayableAmount: true, partnerProfile: { select: { id: true, partnerCode: true, empanelmentStatus: true, bankVerifiedAt: true, user: { select: { name: true } } } } },
    take: MAX_RUN_PAYOUTS + 1,
  });
  if (rows.length > MAX_RUN_PAYOUTS) throw new ApprovalBlockedError("This payout run is too large to check for holds.", ["Split the run into smaller periods."]);
  const holds = findPayoutHolds(rows.map((r) => ({ partnerId: r.partnerProfile.id, code: r.partnerProfile.partnerCode, name: r.partnerProfile.user.name, status: r.partnerProfile.empanelmentStatus, bankVerified: r.partnerProfile.bankVerifiedAt !== null, net: r.netPayableAmount.toFixed() })));
  const decision = evaluateHolds({ holds, role: ctx.actor.role, overrideReason: ctx.options?.holdOverrideReason });
  if (!decision.allow) throw new ApprovalBlockedError("This payout run has holds, so it cannot be approved yet.", decision.reasons);
  if (decision.overridden) {
    await db.auditLog.create({
      data: { userId: ctx.actor.id, entity: "PayoutRun", entityId: payoutRunId, action: "payout_run_hold_overridden", reason: decision.reason, newValue: { holds: holds.map((h) => ({ code: h.code, reasons: h.reasons })) } },
    });
  }
}
