// The retention job: deletes decisions past their keep-time (feedback, outcomes and the disagreement row cascade). One bounded batch per run, so a
// big backlog drains over several ticks; running it twice does no harm. Wrapped by the control plane recorder as "nba-decision-retention".
import { basePrisma } from "@/lib/db/prisma";

import { DECISION_RETENTION, decisionRetentionCutoffs } from "./retention";

export async function runDecisionRetention(opts: { now?: Date; batch?: number } = {}): Promise<{ job: "nba-decision-retention"; deleted: number }> {
  const now = opts.now ?? new Date();
  const take = opts.batch ?? DECISION_RETENTION.batch;
  const c = decisionRetentionCutoffs(now);
  const unreviewed = await basePrisma.decisionRecord.findMany({
    where: { createdAt: { lt: c.unreviewedBefore }, feedback: { none: { userId: { not: "system" } } } },
    select: { id: true },
    take,
  });
  const reviewed = await basePrisma.decisionRecord.findMany({ where: { createdAt: { lt: c.reviewedBefore } }, select: { id: true }, take });
  const ids = [...new Set([...unreviewed, ...reviewed].map((r) => r.id))].slice(0, take);
  if (ids.length === 0) return { job: "nba-decision-retention", deleted: 0 };
  const r = await basePrisma.decisionRecord.deleteMany({ where: { id: { in: ids } } });
  return { job: "nba-decision-retention", deleted: r.count };
}
