import { prisma } from "@/lib/db/prisma";
import { leaderboardFor, quarterProgress, type LeaderboardRow, type Quarter } from "@/lib/targets/quarter";

/**
 * Funded amount: what RMs record on the funding step — funding records marked Partially or Fully Funded whose funding date falls
 * in the period (the same record the "Pushed for funds" gate checks), credited to the client's current RM.
 */
async function fundedByRm(range: { start: Date; end: Date }, rmIds: string[]) {
  const rows = await prisma.fundingRecord.findMany({
    where: {
      status: { in: ["PARTIALLY_FUNDED", "FULLY_FUNDED"] },
      fundingDate: { gte: range.start, lte: range.end },
      client: { isDeleted: false, assignedToId: { in: rmIds } },
    },
    select: { amount: true, client: { select: { assignedToId: true } } },
  });
  const byRm = new Map<string, { funded: number; accounts: number }>();
  for (const r of rows) {
    const rmId = r.client.assignedToId!;
    const cur = byRm.get(rmId) ?? { funded: 0, accounts: 0 };
    cur.funded += r.amount ? Number(r.amount) : 0;
    cur.accounts += 1;
    byRm.set(rmId, cur);
  }
  return byRm;
}

/**
 * The quarter's numbers for one viewer: their scope's total funded against its target (an RM's own; a Manager's team; an Admin's
 * firm — a team's target is the sum of its RMs'), and the leaderboard they may see (see leaderboardFor).
 */
export async function getQuarterScoreboard(viewer: { id: string; role: string }, visibleUserIds: string[] | null, q: Quarter, now = new Date()) {
  const allRms = await prisma.user.findMany({ where: { role: "RM", isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const scopeRms = viewer.role === "RM" ? allRms.filter((r) => r.id === viewer.id) : visibleUserIds ? allRms.filter((r) => visibleUserIds.includes(r.id)) : allRms;
  // An RM's rank is among all RMs, so everyone's totals are needed — but only the rank leaves this function for them.
  const ids = allRms.map((r) => r.id);
  const [funded, targets] = await Promise.all([
    fundedByRm(q, ids),
    prisma.rmTarget.findMany({ where: { quarterStart: q.start, userId: { in: ids } }, select: { userId: true, fundedAmount: true } }),
  ]);
  const targetBy = new Map(targets.map((t) => [t.userId, Number(t.fundedAmount)]));
  const rowFor = (rm: { id: string; name: string }): LeaderboardRow => ({ rmId: rm.id, name: rm.name, funded: funded.get(rm.id)?.funded ?? 0, target: targetBy.get(rm.id) ?? 0 });

  const scopeRows = scopeRms.map(rowFor);
  const totalFunded = scopeRows.reduce((s, r) => s + r.funded, 0);
  const totalTarget = scopeRows.reduce((s, r) => s + r.target, 0);
  const accounts = scopeRms.reduce((s, r) => s + (funded.get(r.id)?.accounts ?? 0), 0);
  return {
    quarter: q,
    funded: totalFunded,
    target: totalTarget,
    accounts,
    avgTicket: accounts > 0 ? totalFunded / accounts : null,
    progress: quarterProgress(totalFunded, totalTarget, q, now),
    rmsWithoutTarget: scopeRows.filter((r) => r.target <= 0).length,
    leaderboard: leaderboardFor(viewer, scopeRows, allRms.map(rowFor)),
  };
}
