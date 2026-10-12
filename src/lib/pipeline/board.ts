import { prisma } from "@/lib/db/prisma";
import { buildClientWhere } from "@/lib/clients/build-client-where";
import { computeSlaStatus, isReferralLeadSource, stageAgeHours, type SlaStatus } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { stageWinRates, type BoardFilter } from "@/lib/pipeline/board-logic";
import type { Prisma } from "@/generated/prisma/client";

/** Cards shown per column; the rest are one click away on the clients list. */
export const CARDS_PER_COLUMN = 20;
/** Completed clients stay on the board this long, so recent wins are visible without the column growing forever. */
export const COMPLETED_WINDOW_DAYS = 30;
/** At-risk is worked out client by client (held time counts), so it looks at no more than this many per stage. */
const AT_RISK_SCAN_LIMIT = 500;
const WIN_RATE_LOOKBACK_DAYS = 365;

export type BoardCard = {
  id: string;
  name: string;
  clientCode: string;
  assignedToName: string | null;
  expectedInvestment: number | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  ageHours: number;
  slaStatus: SlaStatus;
};

export type BoardColumn = {
  stageId: string;
  name: string;
  sequence: number;
  count: number;
  /** Sum of expected investment across every client in the column, not just the cards shown. */
  totalExpected: number;
  /** totalExpected × the historical chance of completing from this stage; null without enough history. */
  weightedExpected: number | null;
  winRate: number | null;
  cards: BoardCard[];
  /** The clients list showing everyone in this column, for the "+N more" link. */
  listHref: string;
};

export async function getPipelineBoard(opts: {
  userId: string;
  role: string;
  visibleUserIds: string[] | null;
  filter: BoardFilter;
  rm?: string;
  now?: Date;
}): Promise<BoardColumn[]> {
  const now = opts.now ?? new Date();
  const scope = buildClientWhere({ rm: opts.rm }, opts.visibleUserIds, { includeUnassigned: opts.role === "MANAGER" });
  const filterWhere: Prisma.ClientWhereInput =
    opts.filter === "mine" ? { assignedToId: opts.userId } : opts.filter === "hot" ? { priority: "HIGH" } : {};

  const stages = await prisma.stage.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" } });
  const finalStage = stages.at(-1);
  const completedSince = new Date(now.getTime() - COMPLETED_WINDOW_DAYS * 86_400_000);
  const whereFor = (stage: (typeof stages)[number]): Prisma.ClientWhereInput => ({
    AND: [
      scope,
      filterWhere,
      { currentStageId: stage.id },
      stage.id === finalStage?.id ? { status: "COMPLETED", completedAt: { gte: completedSince } } : { status: "ACTIVE" },
    ],
  });

  const select = {
    id: true,
    name: true,
    clientCode: true,
    expectedInvestment: true,
    priority: true,
    stageEnteredAt: true,
    currentStageId: true,
    leadSource: true,
    assignedTo: { select: { name: true } },
  } as const;

  const [winRates, perStage] = await Promise.all([
    loadWinRates(stages.map((s) => s.id), now),
    Promise.all(
      stages.map(async (stage) => {
        const where = whereFor(stage);
        if (opts.filter === "at-risk") {
          // Only clients past the stage's SLA on the raw clock can be overdue (held time only adds slack), so narrow in SQL first.
          if (stage.slaHours <= 0) return { stage, rows: [] as BoardCard[], count: 0, total: 0 };
          const candidates = await findRows({ AND: [where, { stageEnteredAt: { lt: new Date(now.getTime() - stage.slaHours * 3_600_000) } }] }, AT_RISK_SCAN_LIMIT);
          const overdue = (await withSla(candidates, stage.slaHours, now)).filter((c) => c.slaStatus === "OVERDUE");
          return { stage, rows: overdue, count: overdue.length, total: overdue.reduce((sum, c) => sum + (c.expectedInvestment ?? 0), 0) };
        }
        const [rows, agg] = await Promise.all([
          findRows(where, CARDS_PER_COLUMN).then((r) => withSla(r, stage.slaHours, now)),
          prisma.client.aggregate({ where, _count: { _all: true }, _sum: { expectedInvestment: true } }),
        ]);
        return { stage, rows, count: agg._count._all, total: Number(agg._sum.expectedInvestment ?? 0) };
      }),
    ),
  ]);

  return perStage.map(({ stage, rows, count, total }) => {
    const winRate = winRates.get(stage.id) ?? null;
    const list = new URLSearchParams({ stage: stage.id, status: stage.id === finalStage?.id ? "COMPLETED" : "ACTIVE" });
    if (opts.rm) list.set("rm", opts.rm);
    if (opts.filter === "mine") list.set("rm", opts.userId);
    if (opts.filter === "hot") list.set("priority", "HIGH");
    if (opts.filter === "at-risk") list.set("sla", "OVERDUE");
    return {
      stageId: stage.id,
      name: stage.name,
      sequence: stage.sequence,
      count,
      totalExpected: total,
      weightedExpected: winRate === null ? null : total * winRate,
      winRate,
      cards: rows.slice(0, CARDS_PER_COLUMN),
      listHref: `/clients?${list.toString()}`,
    };
  });

  function findRows(where: Prisma.ClientWhereInput, take: number) {
    // Longest in the stage first: the ones most likely to need a push.
    return prisma.client.findMany({ where, select, orderBy: { stageEnteredAt: "asc" }, take });
  }
}

/** Adds each client's SLA status (held time from exceptions excluded, referral leads exempt) — the clients list's rule. */
async function withSla(
  rows: { id: string; name: string; clientCode: string; expectedInvestment: Prisma.Decimal | null; priority: BoardCard["priority"]; stageEnteredAt: Date; currentStageId: string; leadSource: string | null; assignedTo: { name: string } | null }[],
  slaHours: number,
  now: Date,
): Promise<BoardCard[]> {
  const exceptions = rows.length
    ? await prisma.exception.findMany({
        where: { clientId: { in: rows.map((r) => r.id) } },
        select: { clientId: true, stageId: true, createdAt: true, resolvedAt: true },
      })
    : [];
  return rows.map((r) => {
    const heldMs = exceptions
      .filter((e) => e.clientId === r.id && e.stageId === r.currentStageId)
      .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
    return {
      id: r.id,
      name: r.name,
      clientCode: r.clientCode,
      assignedToName: r.assignedTo?.name ?? null,
      expectedInvestment: r.expectedInvestment === null ? null : Number(r.expectedInvestment),
      priority: r.priority,
      ageHours: stageAgeHours(r.stageEnteredAt),
      slaStatus: isReferralLeadSource(r.leadSource) ? "NOT_APPLICABLE" : computeSlaStatus(effectiveStageEnteredAt(r.stageEnteredAt, heldMs), slaHours, now),
    };
  });
}

/** Firm-wide odds of completing from each stage, from clients finished in the last year (an estimate, not anyone's data). */
async function loadWinRates(stageIds: string[], now: Date) {
  const since = new Date(now.getTime() - WIN_RATE_LOOKBACK_DAYS * 86_400_000);
  const finished = await prisma.client.findMany({
    where: { isDeleted: false, status: { in: ["COMPLETED", "NOT_PROCEEDING"] }, updatedAt: { gte: since } },
    select: { status: true, stageHistory: { select: { toStageId: true } } },
  });
  return stageWinRates(
    stageIds,
    finished.map((c) => ({ reachedStageIds: c.stageHistory.map((h) => h.toStageId), completed: c.status === "COMPLETED" })),
  );
}
