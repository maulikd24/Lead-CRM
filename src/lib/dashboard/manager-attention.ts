import { prisma } from "@/lib/db/prisma";
import { computeSlaStatus, stageAgeHours } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt, getHeldDurationMs } from "@/lib/stage-engine/held-duration";

export type AttentionCategory =
  | "sla_breach"
  | "high_priority_overdue"
  | "kyc_rejection"
  | "no_next_action"
  | "repeated_failed_contact"
  | "unresolved_exception"
  | "stage_corrected";

export type AttentionRow = {
  clientId: string;
  clientName: string;
  clientCode: string;
  rmName: string | null;
  rmId: string | null;
  stageName: string;
  blockerReason: string | null;
  ageHours: number;
  category: AttentionCategory;
  recommendedAction: string;
};

const CATEGORY_ACTION: Record<AttentionCategory, string> = {
  sla_breach: "Follow up immediately — stage SLA has been breached",
  high_priority_overdue: "Prioritize — high-priority client is overdue",
  kyc_rejection: "Review KYC rejection / provide additional information",
  no_next_action: "Reassign or set a follow-up — no open task exists",
  repeated_failed_contact: "Consider reassignment — repeated failed contact attempts",
  unresolved_exception: "Resolve the open blocker",
  stage_corrected: "Review recent manual stage correction",
};

const FAILED_CONTACT_OUTCOMES = ["Unreachable", "Wrong number", "Not interested"];
const FAILED_CONTACT_THRESHOLD = 2;
const RECENT_CORRECTION_DAYS = 7;
const FUNDING_SLA_STAGE_NAME = "KYC completed";
const FUNDING_SLA_ESCALATION_HOURS = 48;
const FUNDING_SLA_BREACH_ACTION =
  "Funding SLA breach — KYC completed but funding still pending 48h+; escalate to RM's manager";

/**
 * Aggregates everything a Manager/Admin should look at: SLA breaches, high-priority
 * overdue clients, KYC rejections, clients with no next action, repeated failed
 * contacts, unresolved blockers, and recent manual stage corrections (visibility
 * only — there's no request/approval workflow for corrections today).
 */
export async function getManagerAttentionRows(
  visibleUserIds: string[] | null,
  options: { limit?: number } = {},
): Promise<AttentionRow[]> {
  const clientFilter = visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {};
  const now = new Date();

  const [activeClients, exceptions, recentCorrections] = await Promise.all([
    prisma.client.findMany({
      where: { ...clientFilter, status: "ACTIVE" },
      include: { currentStage: true, assignedTo: true, kycRecord: true, fundingRecord: true },
    }),
    prisma.exception.findMany({
      select: { clientId: true, stageId: true, reason: true, status: true, createdAt: true, resolvedAt: true },
    }),
    prisma.auditLog.findMany({
      where: { action: "stage_corrected", timestamp: { gte: new Date(now.getTime() - RECENT_CORRECTION_DAYS * 86400000) } },
      select: { entityId: true },
    }),
  ]);

  const clientIds = activeClients.map((c) => c.id);
  const openExceptionByClient = new Map(
    exceptions.filter((e) => e.status === "OPEN").map((e) => [e.clientId, e.reason]),
  );
  const correctedClientIds = new Set(recentCorrections.map((c) => c.entityId));

  const failedContactActivities = clientIds.length
    ? await prisma.activity.findMany({
        where: { clientId: { in: clientIds }, type: "NOTE" },
        select: { clientId: true, payload: true },
      })
    : [];
  const failedContactCountByClient = new Map<string, number>();
  for (const activity of failedContactActivities) {
    const payload = activity.payload as { contactOutcome?: string } | null;
    if (payload?.contactOutcome && FAILED_CONTACT_OUTCOMES.includes(payload.contactOutcome)) {
      failedContactCountByClient.set(activity.clientId, (failedContactCountByClient.get(activity.clientId) ?? 0) + 1);
    }
  }

  const rows: AttentionRow[] = [];

  for (const client of activeClients) {
    const heldMs = await getHeldDurationMs(client.id, client.currentStageId, now);
    const effectiveEnteredAt = effectiveStageEnteredAt(client.stageEnteredAt, heldMs);
    const slaStatus = computeSlaStatus(effectiveEnteredAt, client.currentStage.slaHours, now);
    const ageHours = stageAgeHours(effectiveEnteredAt, now);
    const blockerReason = openExceptionByClient.get(client.id) ?? null;

    const base = {
      clientId: client.id,
      clientName: client.name,
      clientCode: client.clientCode,
      rmName: client.assignedTo?.name ?? null,
      rmId: client.assignedToId,
      stageName: client.currentStage.name,
      blockerReason,
      ageHours,
    };

    const fundingPending = !client.fundingRecord || client.fundingRecord.status === "PENDING";
    const isFundingSlaBreach =
      client.currentStage.name === FUNDING_SLA_STAGE_NAME &&
      fundingPending &&
      ageHours >= FUNDING_SLA_ESCALATION_HOURS;

    if (slaStatus === "OVERDUE" || isFundingSlaBreach) {
      rows.push({
        ...base,
        category: "sla_breach",
        recommendedAction: slaStatus === "OVERDUE" ? CATEGORY_ACTION.sla_breach : FUNDING_SLA_BREACH_ACTION,
      });
    } else if (client.priority === "HIGH") {
      // only flag high-priority-and-overdue when not already captured as a straight SLA breach
      const dueSoonOrOverdue = slaStatus === "DUE_SOON";
      if (dueSoonOrOverdue) {
        rows.push({ ...base, category: "high_priority_overdue", recommendedAction: CATEGORY_ACTION.high_priority_overdue });
      }
    }

    if (client.kycRecord?.status === "REJECTED" || client.kycRecord?.status === "ADDITIONAL_INFO_REQUIRED") {
      rows.push({ ...base, category: "kyc_rejection", recommendedAction: CATEGORY_ACTION.kyc_rejection });
    }

    if (!client.nextActionTitle) {
      rows.push({ ...base, category: "no_next_action", recommendedAction: CATEGORY_ACTION.no_next_action });
    }

    if ((failedContactCountByClient.get(client.id) ?? 0) >= FAILED_CONTACT_THRESHOLD) {
      rows.push({ ...base, category: "repeated_failed_contact", recommendedAction: CATEGORY_ACTION.repeated_failed_contact });
    }

    if (blockerReason) {
      rows.push({ ...base, category: "unresolved_exception", recommendedAction: CATEGORY_ACTION.unresolved_exception });
    }

    if (correctedClientIds.has(client.id)) {
      rows.push({ ...base, category: "stage_corrected", recommendedAction: CATEGORY_ACTION.stage_corrected });
    }
  }

  rows.sort((a, b) => b.ageHours - a.ageHours);

  return options.limit ? rows.slice(0, options.limit) : rows;
}
