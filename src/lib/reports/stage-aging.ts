import { computeSlaStatus, stageAgeHours } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";

export type AgingBucket = "0-24h" | "24-48h" | "48-72h" | "72h+";
export const AGING_BUCKETS: AgingBucket[] = ["0-24h", "24-48h", "48-72h", "72h+"];

export type StageAgingRow = {
  stageId: string;
  stageName: string;
  sequence: number;
  buckets: Record<AgingBucket, number>;
  total: number;
};

export type SlaBreachRow = { key: string; label: string; overdue: number; dueSoon: number };

// Mirrors manager-attention.ts's funding-specific SLA override exactly, so the Reports summary
// panel and the Exceptions queue never disagree about which clients count as an SLA breach.
const FUNDING_SLA_STAGE_NAME = "KYC completed";
const FUNDING_SLA_ESCALATION_HOURS = 48;

function bucketFor(ageHours: number): AgingBucket {
  if (ageHours < 24) return "0-24h";
  if (ageHours < 48) return "24-48h";
  if (ageHours < 72) return "48-72h";
  return "72h+";
}

function emptyBuckets(): Record<AgingBucket, number> {
  return { "0-24h": 0, "24-48h": 0, "48-72h": 0, "72h+": 0 };
}

/**
 * Single pass over currently-active clients producing both a live stage-aging histogram
 * (where are clients piling up right now, unlike Bottleneck Analysis's historical average)
 * and OVERDUE/DUE_SOON counts by stage and by RM, for the Reports SLA breach summary panel.
 */
export function computeStageAging(
  activeClientRows: {
    id: string;
    assignedToId: string | null;
    currentStageId: string;
    stageEnteredAt: Date;
    currentStage: { name: string; slaHours: number };
    fundingRecord: { status: string } | null;
  }[],
  exceptionsForActive: { clientId: string; stageId: string; createdAt: Date; resolvedAt: Date | null }[],
  stages: { id: string; name: string; sequence: number }[],
  rms: { id: string; name: string }[],
  now: Date,
): { aging: StageAgingRow[]; slaByStage: SlaBreachRow[]; slaByRm: SlaBreachRow[] } {
  const agingByStage = new Map<string, Record<AgingBucket, number>>();
  const slaByStage = new Map<string, { overdue: number; dueSoon: number }>();
  const slaByRm = new Map<string, { overdue: number; dueSoon: number }>();

  for (const stage of stages) {
    agingByStage.set(stage.id, emptyBuckets());
    slaByStage.set(stage.id, { overdue: 0, dueSoon: 0 });
  }
  for (const rm of rms) {
    slaByRm.set(rm.id, { overdue: 0, dueSoon: 0 });
  }

  for (const client of activeClientRows) {
    const heldMs = exceptionsForActive
      .filter((e) => e.clientId === client.id && e.stageId === client.currentStageId)
      .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
    const effectiveEnteredAt = effectiveStageEnteredAt(client.stageEnteredAt, heldMs);
    const ageHours = stageAgeHours(effectiveEnteredAt, now);
    const slaStatus = computeSlaStatus(effectiveEnteredAt, client.currentStage.slaHours, now);

    const buckets = agingByStage.get(client.currentStageId);
    if (buckets) buckets[bucketFor(ageHours)] += 1;

    const fundingPending = !client.fundingRecord || client.fundingRecord.status === "PENDING";
    const isFundingSlaBreach =
      client.currentStage.name === FUNDING_SLA_STAGE_NAME && fundingPending && ageHours >= FUNDING_SLA_ESCALATION_HOURS;
    const effectiveStatus = slaStatus === "OVERDUE" || isFundingSlaBreach ? "OVERDUE" : slaStatus;

    if (effectiveStatus === "OVERDUE" || effectiveStatus === "DUE_SOON") {
      const stageCounts = slaByStage.get(client.currentStageId);
      if (stageCounts) {
        if (effectiveStatus === "OVERDUE") stageCounts.overdue += 1;
        else stageCounts.dueSoon += 1;
      }
      if (client.assignedToId) {
        const rmCounts = slaByRm.get(client.assignedToId);
        if (rmCounts) {
          if (effectiveStatus === "OVERDUE") rmCounts.overdue += 1;
          else rmCounts.dueSoon += 1;
        }
      }
    }
  }

  const aging: StageAgingRow[] = stages
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((stage) => {
      const buckets = agingByStage.get(stage.id) ?? emptyBuckets();
      return {
        stageId: stage.id,
        stageName: stage.name,
        sequence: stage.sequence,
        buckets,
        total: AGING_BUCKETS.reduce((sum, b) => sum + buckets[b], 0),
      };
    });

  const slaByStageRows: SlaBreachRow[] = stages
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((stage) => {
      const counts = slaByStage.get(stage.id) ?? { overdue: 0, dueSoon: 0 };
      return { key: stage.id, label: stage.name, overdue: counts.overdue, dueSoon: counts.dueSoon };
    });

  const slaByRmRows: SlaBreachRow[] = rms.map((rm) => {
    const counts = slaByRm.get(rm.id) ?? { overdue: 0, dueSoon: 0 };
    return { key: rm.id, label: rm.name, overdue: counts.overdue, dueSoon: counts.dueSoon };
  });

  return { aging, slaByStage: slaByStageRows, slaByRm: slaByRmRows };
}
