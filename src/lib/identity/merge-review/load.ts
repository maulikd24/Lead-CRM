import { prisma } from "@/lib/db/prisma";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import type { Role } from "@/generated/prisma/client";
import { inScope, type Actor } from "./decide";
import { chooseSurvivor, planMerge, type MergePlan, type SideFacts } from "./plan";
import { APP_SIGNUP_SOURCE, appIdLinkingEnabled, distinctAppUserIds } from "@/lib/integrations/clevertap/identity";
import { buildComparison, confidenceOf, countRows, firstName, reasonText, type CardInput, type CompareRow } from "./view-model";

export const QUEUE_LIMIT = 100;
const LIVE = { isDeleted: false, mergedIntoId: null } as const;

/** Prisma filter for "a customer this actor may see": admins all; managers their team plus the unassigned pool. */
function scopeWhere(role: Role, visible: string[] | null) {
  if (visible === null) return {};
  return { OR: [{ assignedToId: { in: visible } }, ...(role === "MANAGER" ? [{ assignedToId: null }] : [])] };
}

export type QueueItem = {
  id: string;
  score: number;
  percent: number;
  label: string;
  reasons: string[];
  a: { id: string; first: string; code: string };
  b: { id: string; first: string; code: string };
};

/** Open suggestions the actor can act on (both customers live and in scope), best first. Lists carry first names and client codes only. */
export async function loadQueue(actor: Actor): Promise<{ total: number; items: QueueItem[] }> {
  const visible = await getVisibleUserIds(actor.id, actor.role);
  const where = { status: "OPEN", clientA: { ...LIVE, ...scopeWhere(actor.role, visible) }, clientB: { ...LIVE, ...scopeWhere(actor.role, visible) } };
  const [total, rows] = await Promise.all([
    prisma.mergeSuggestion.count({ where }),
    prisma.mergeSuggestion.findMany({
      where,
      orderBy: [{ score: "desc" }, { createdAt: "asc" }],
      take: QUEUE_LIMIT,
      select: { id: true, score: true, reasons: true, clientA: { select: { id: true, name: true, clientCode: true } }, clientB: { select: { id: true, name: true, clientCode: true } } },
    }),
  ]);
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      score: r.score,
      ...confidenceOf(r.score),
      reasons: r.reasons.map(reasonText),
      a: { id: r.clientA.id, first: firstName(r.clientA.name), code: r.clientA.clientCode },
      b: { id: r.clientB.id, first: firstName(r.clientB.name), code: r.clientB.clientCode },
    })),
  };
}

const COUNT_SELECT = {
  activities: true, messages: true, tasks: true, documents: true, deviceCalls: true, payments: true, stageHistory: true, exceptions: true,
  tradingAccounts: true, revenueEvents: true, pmsAifHoldings: true, kycSteps: true, opportunities: true, householdMemberships: true, journeyRuns: true,
} as const;

async function loadSide(id: string) {
  const [c, positions, lastActivity, appRows] = await Promise.all([
    prisma.client.findUnique({
      where: { id },
      select: {
        id: true, name: true, clientCode: true, mobile: true, email: true, pan: true, city: true, leadSource: true, createdAt: true, ckycRef: true, region: true,
        currentStage: { select: { name: true } },
        assignedTo: { select: { name: true } },
        kycRecord: { select: { status: true } },
        fundingRecord: { select: { status: true } },
        dealerIntroduction: { select: { id: true } },
        accountHolders: { where: { isDeleted: false }, select: { position: true } },
        _count: { select: COUNT_SELECT },
      },
    }),
    prisma.position.count({ where: { tradingAccount: { clientId: id } } }),
    prisma.activity.findFirst({ where: { clientId: id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.leadIntake.findMany({ where: { source: APP_SIGNUP_SOURCE, clientId: id, status: { in: ["CREATED", "DUPLICATE"] } }, select: { externalId: true }, take: 10 }),
  ]);
  if (!c) return null;
  const k = c._count;
  const filled = [c.mobile, c.email, c.pan, c.city, c.region, c.ckycRef, c.leadSource].filter((v) => !!v && String(v).trim()).length;
  const facts: SideFacts = {
    id: c.id,
    pan: c.pan,
    kycStarted: !!c.kycRecord,
    kycCompleted: c.kycRecord?.status === "APPROVED",
    hasKycRecord: !!c.kycRecord,
    hasFundingRecord: !!c.fundingRecord,
    hasDealerIntro: !!c.dealerIntroduction,
    holders: c.accountHolders,
    completeness: filled,
    appUserIds: distinctAppUserIds(appRows),
    createdAt: c.createdAt,
    counts: {
      documents: k.documents, tasks: k.tasks, activities: k.activities, calls: k.deviceCalls, payments: k.payments, stageHistory: k.stageHistory,
      exceptions: k.exceptions, tradingAccounts: k.tradingAccounts, revenueEvents: k.revenueEvents, messages: k.messages, positions,
      holdings: k.pmsAifHoldings, kycSteps: k.kycSteps, opportunities: k.opportunities, householdMemberships: k.householdMemberships, journeyRuns: k.journeyRuns,
    },
  };
  const card: CardInput = {
    id: c.id, name: c.name, clientCode: c.clientCode, mobile: c.mobile, email: c.email, pan: c.pan, city: c.city, leadSource: c.leadSource,
    stage: c.currentStage.name,
    kyc: c.kycRecord ? c.kycRecord.status.replaceAll("_", " ").toLowerCase() : "Not started",
    funding: c.fundingRecord ? c.fundingRecord.status.replaceAll("_", " ").toLowerCase() : "Not started",
    assignedTo: c.assignedTo?.name ?? null,
    lastActivityAt: lastActivity?.createdAt ?? null,
    createdAt: c.createdAt,
  };
  return { facts, card };
}

export type ComparisonData = {
  suggestionId: string;
  percent: number;
  label: string;
  reasons: string[];
  rows: CompareRow[];
  sides: { a: { id: string; first: string; code: string }; b: { id: string; first: string; code: string } };
  defaultSurvivorId: string;
  why: string;
  /** What merging does, for each possible choice of survivor, so the reviewer can flip without a round trip. */
  plans: Record<string, MergePlan>;
};

export type ComparisonResult = { ok: true; data: ComparisonData } | { ok: false; error: string };

/** Everything the review screen shows for one suggestion. Re-checks role, scope and that the suggestion is still open. */
export async function loadComparison(actor: Actor, suggestionId: string): Promise<ComparisonResult> {
  if (actor.role !== "ADMIN" && actor.role !== "MANAGER") return { ok: false, error: "Only an Admin or Manager can review duplicate customers." };
  const s = await prisma.mergeSuggestion.findUnique({
    where: { id: suggestionId },
    select: {
      id: true, status: true, score: true, reasons: true,
      clientA: { select: { id: true, isDeleted: true, mergedIntoId: true, assignedToId: true } },
      clientB: { select: { id: true, isDeleted: true, mergedIntoId: true, assignedToId: true } },
    },
  });
  if (!s) return { ok: false, error: "That suggestion no longer exists." };
  if (s.status !== "OPEN") return { ok: false, error: "Someone has already decided this suggestion." };
  if ([s.clientA, s.clientB].some((c) => c.isDeleted || c.mergedIntoId)) return { ok: false, error: "One of these customers was already merged, archived or removed." };
  const visible = await getVisibleUserIds(actor.id, actor.role);
  if (![s.clientA, s.clientB].every((c) => inScope(visible, actor.role, c.assignedToId))) return { ok: false, error: "You do not have access to both of these customers." };

  const [a, b] = await Promise.all([loadSide(s.clientA.id), loadSide(s.clientB.id)]);
  if (!a || !b) return { ok: false, error: "One of these customers was already merged, archived or removed." };
  const linkAppIds = appIdLinkingEnabled();
  const pick = chooseSurvivor(a.facts, b.facts);
  const rows = [...buildComparison(a.card, b.card), ...countRows(a.facts.counts, b.facts.counts)];
  return {
    ok: true,
    data: {
      suggestionId: s.id,
      ...confidenceOf(s.score),
      reasons: s.reasons.map(reasonText),
      rows,
      sides: {
        a: { id: a.card.id, first: firstName(a.card.name), code: a.card.clientCode },
        b: { id: b.card.id, first: firstName(b.card.name), code: b.card.clientCode },
      },
      defaultSurvivorId: pick.survivorId,
      why: pick.why,
      plans: { [a.facts.id]: planMerge(a.facts, b.facts, { linkAppIds }), [b.facts.id]: planMerge(b.facts, a.facts, { linkAppIds }) },
    },
  };
}
