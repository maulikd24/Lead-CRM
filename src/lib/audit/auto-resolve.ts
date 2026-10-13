/**
 * Auto-resolve: when a commitment that carried a MISSED_FOLLOW_UP finding is later marked KEPT, the finding is resolved by the
 * system. Runs inside the same transaction as the commitment change (see service/store.ts), so the two cannot disagree.
 *
 * The audit row is attributed to the system actor, not to the RM who marked the commitment kept: no person resolved the finding.
 * resolvedById stays null for the same reason. The note says why it was resolved.
 *
 * Only OPEN or ACKNOWLEDGED findings are touched. A finding a person already dismissed or resolved is left as it is.
 * If the system actor row does not exist yet, nothing is changed: the audit row needs a real user, the same rule as the AI pass.
 */
import type { FindingDbStatus } from "./finding-actions";
import { SYSTEM_ACTOR_EMAIL } from "../system/system-actor-email";

export const SYSTEM_NOTE = "System note: resolved automatically because the commitment was marked kept.";

export type AutoResolveTx = {
  auditFinding: {
    findFirst(args: { where: { dedupeKey: string; status: { in: FindingDbStatus[] } }; select: { id: true; status: true } }): Promise<{ id: string; status: FindingDbStatus } | null>;
    updateMany(args: { where: { id: string; status: { in: FindingDbStatus[] } }; data: { status: "RESOLVED"; resolvedAt: Date; resolvedById: null } }): Promise<{ count: number }>;
  };
  user: {
    findUnique(args: { where: { email: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
  auditLog: {
    create(args: { data: { userId: string; entity: string; entityId: string; action: string; oldValue: unknown; newValue: unknown; reason: string; timestamp: Date } }): Promise<unknown>;
  };
};

export const missedFollowUpKey = (commitmentId: string) => `COMMITMENT:${commitmentId}:MISSED_FOLLOW_UP`;

/**
 * Resolves the commitment's MISSED_FOLLOW_UP finding if one is open. Returns "resolved" when it changed a finding, "none" otherwise.
 */
export async function autoResolveMissedFollowUp(tx: AutoResolveTx, input: { commitmentId: string; now: Date }): Promise<"resolved" | "none"> {
  const open = ["OPEN", "ACKNOWLEDGED"] as FindingDbStatus[];
  const finding = await tx.auditFinding.findFirst({
    where: { dedupeKey: missedFollowUpKey(input.commitmentId), status: { in: open } },
    select: { id: true, status: true },
  });
  if (!finding) return "none";
  const system = await tx.user.findUnique({ where: { email: SYSTEM_ACTOR_EMAIL }, select: { id: true } });
  if (!system) return "none";
  const changed = await tx.auditFinding.updateMany({
    where: { id: finding.id, status: { in: open } },
    data: { status: "RESOLVED", resolvedAt: input.now, resolvedById: null },
  });
  if (changed.count !== 1) return "none";
  await tx.auditLog.create({
    data: {
      userId: system.id,
      entity: "AuditFinding",
      entityId: finding.id,
      action: "audit_finding.auto_resolved",
      oldValue: { status: finding.status },
      newValue: { status: "RESOLVED" },
      reason: SYSTEM_NOTE,
      timestamp: input.now,
    },
  });
  return "resolved";
}
