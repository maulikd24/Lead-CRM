import { prisma } from "@/lib/db/prisma";
import { buildConsentStatus } from "@/lib/c360/consent";
import { loadSnapshots } from "@/lib/consent/store-prisma";
import { computeAssetAllocation } from "@/lib/wealth/portfolio-analytics";

import { DAY_MS, reviewStatus, type ReviewStatus } from "./cadence";
import { buildGoalView, type GoalView, type HoldingRef } from "./goals";
import { computeAttentionScore, type AttentionScore } from "./risk";
import { applyDismissals, evaluateRules } from "./rules";
import type { OutcomeSubject, Suggestion } from "./types";

// Bulk loaders: a fixed number of queries for any number of customers (no per-customer queries), so the single-customer
// tab and the team list share one code path. Callers pass client ids they have ALREADY authorised (the page's access
// check, or the visibility filter in `loadAttentionList`); nothing here widens access.

const POSITION_WINDOW_DAYS = 400;
const REFERENCE_AGE_DAYS = 75;
const OPEN_TICKET = (status: string | null) => !new Set(["resolved", "closed"]).has((status ?? "").toLowerCase());
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : Number(v));

export type OutcomeBundle = {
  subject: OutcomeSubject;
  holdings: HoldingRef[];
  goals: GoalView[];
  review: ReviewStatus;
  score: AttentionScore;
  suggestions: Suggestion[];
};

export async function loadOutcomeBundles(clientIds: string[], now: Date = new Date(), opts: { includeInactiveGoals?: boolean } = {}): Promise<Map<string, OutcomeBundle>> {
  const out = new Map<string, OutcomeBundle>();
  if (clientIds.length === 0) return out;
  const since = new Date(now.getTime() - POSITION_WINDOW_DAYS * DAY_MS);
  const referenceBefore = new Date(now.getTime() - REFERENCE_AGE_DAYS * DAY_MS);
  const where = { clientId: { in: clientIds } };

  const [clients, latest, reference, accounts, contacts, ticketCounts, insights, negReviews, snapshots, goalRows, reviews, dismissals] = await Promise.all([
    prisma.client.findMany({
      where: { id: { in: clientIds }, isDeleted: false, mergedIntoId: null },
      select: { id: true, name: true, createdAt: true, assignedToId: true, marketingConsentAt: true, assignedTo: { select: { name: true } }, kycRecord: { select: { status: true } }, intelligence: { select: { idleCashEstimate: true, estimatesSource: true, estimatesUpdatedAt: true } } },
    }),
    prisma.position.findMany({
      where: { tradingAccount: where, asOfDate: { gte: since } },
      orderBy: { asOfDate: "desc" },
      distinct: ["tradingAccountId", "productId"],
      select: { tradingAccountId: true, productId: true, quantity: true, currentValue: true, tradingAccount: { select: { clientId: true } }, product: { select: { name: true, category: true } } },
    }),
    prisma.position.findMany({
      where: { tradingAccount: where, asOfDate: { gte: since, lte: referenceBefore } },
      orderBy: { asOfDate: "desc" },
      distinct: ["tradingAccountId", "productId"],
      select: { quantity: true, currentValue: true, tradingAccount: { select: { clientId: true } } },
    }),
    prisma.tradingAccount.findMany({ where, select: { id: true, clientId: true } }),
    prisma.activity.groupBy({ by: ["clientId"], where: { ...where, type: { in: ["CALL", "MESSAGE", "MEETING", "CONTACT"] } }, _max: { createdAt: true } }),
    prisma.supportTicket.groupBy({ by: ["clientId", "status"], where, _count: { _all: true } }),
    prisma.conversationInsight.findMany({ where: { ...where, status: "OPEN", kind: { in: ["COMPLAINT", "COMMITMENT"] } }, select: { clientId: true, kind: true, text: true, dueAt: true }, take: 5000 }),
    prisma.conversationReview.findMany({ where: { ...where, status: "ANALYZED", analyzedAt: { gte: new Date(now.getTime() - 14 * DAY_MS) }, OR: [{ sentimentLabel: "negative" }, { qualityScore: { lt: 50 } }] }, select: { clientId: true }, distinct: ["clientId"] }),
    loadSnapshots(clientIds),
    prisma.customerGoal.findMany({ where: { ...where, ...(opts.includeInactiveGoals ? { status: { not: "ARCHIVED" } } : { status: "ACTIVE" }) }, orderBy: [{ targetDate: "asc" }] }),
    prisma.customerReview.groupBy({ by: ["clientId"], where, _max: { reviewedAt: true } }),
    prisma.suggestionDismissal.findMany({ where: { ...where, snoozeUntil: { gt: now } }, select: { clientId: true, ruleKey: true, fingerprint: true } }),
  ]);

  // Latest transaction per client, through the client's trading accounts.
  const accountClient = new Map(accounts.map((a) => [a.id, a.clientId]));
  const txMax = accounts.length
    ? await prisma.transaction.groupBy({ by: ["tradingAccountId"], where: { tradingAccountId: { in: accounts.map((a) => a.id) } }, _max: { transactionDate: true } })
    : [];
  const lastTx = new Map<string, Date>();
  for (const t of txMax) {
    const cid = accountClient.get(t.tradingAccountId);
    const d = t._max.transactionDate;
    if (cid && d && (!lastTx.get(cid) || d > lastTx.get(cid)!)) lastTx.set(cid, d);
  }

  const byClient = <T extends { clientId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(r.clientId) ?? m.set(r.clientId, []).get(r.clientId)!).push(r);
    return m;
  };
  const holdingsBy = new Map<string, HoldingRef[]>();
  for (const p of latest) {
    if (!(Number(p.quantity) > 0)) continue;
    const cid = p.tradingAccount.clientId;
    (holdingsBy.get(cid) ?? holdingsBy.set(cid, []).get(cid)!).push({ accountId: p.tradingAccountId, productId: p.productId, name: p.product.name, category: p.product.category, value: num(p.currentValue) ?? 0 });
  }
  const refTotal = new Map<string, number>();
  for (const p of reference) if (Number(p.quantity) > 0) refTotal.set(p.tradingAccount.clientId, (refTotal.get(p.tradingAccount.clientId) ?? 0) + (num(p.currentValue) ?? 0));
  const contactBy = new Map(contacts.map((c) => [c.clientId, c._max.createdAt]));
  const openTickets = new Map<string, number>();
  for (const t of ticketCounts) if (OPEN_TICKET(t.status)) openTickets.set(t.clientId, (openTickets.get(t.clientId) ?? 0) + t._count._all);
  const insightBy = byClient(insights);
  const negative = new Set(negReviews.map((r) => r.clientId));
  const goalsBy = byClient(goalRows);
  const reviewBy = new Map(reviews.map((r) => [r.clientId, r._max.reviewedAt]));
  const dismissBy = byClient(dismissals);

  for (const c of clients) {
    const holdings = holdingsBy.get(c.id) ?? [];
    const aum = holdings.reduce((s, h) => s + h.value, 0);
    const allocation = aum > 0 ? computeAssetAllocation(holdings.map((h) => ({ productId: h.productId, tradingAccountId: h.accountId, currentValue: h.value, product: { name: h.name, category: h.category as never } }))).filter((r) => r.value > 0).map((r) => ({ bucket: r.bucket, pct: r.pct })) : [];
    const snap = snapshots.get(c.id);
    const consent = buildConsentStatus({ records: snap?.records ?? [], now, marketingConsentAt: c.marketingConsentAt, marketingConsentText: null, openIssueCount: 0, nbaProgramme: null }).marketing;
    const goals = (goalsBy.get(c.id) ?? []).map((g) =>
      buildGoalView({ id: g.id, name: g.name, targetAmount: Number(g.targetAmount), targetDate: g.targetDate, priority: g.priority, status: g.status, annualRatePct: num(g.assumedAnnualRatePct), plannedMonthly: num(g.plannedMonthly), notes: g.notes, linkedAccountIds: g.linkedAccountIds, linkedHoldingKeys: g.linkedHoldingKeys }, holdings, now),
    );
    const ins = insightBy.get(c.id) ?? [];
    const cash = num(c.intelligence?.idleCashEstimate);
    const subject: OutcomeSubject = {
      clientId: c.id, name: c.name, rmId: c.assignedToId, rmName: c.assignedTo?.name ?? null, createdAt: c.createdAt,
      kycStatus: c.kycRecord?.status ?? null, aum, holdingCount: holdings.length, aumReference: refTotal.get(c.id) ?? null, allocation,
      idleCash: cash && cash > 0 ? { amount: cash, source: c.intelligence?.estimatesSource ?? null, updatedAt: c.intelligence?.estimatesUpdatedAt ?? null } : null,
      lastContactAt: contactBy.get(c.id) ?? null, lastTransactionAt: lastTx.get(c.id) ?? null, lastReviewAt: reviewBy.get(c.id) ?? null,
      openTickets: openTickets.get(c.id) ?? 0, openComplaints: ins.filter((i) => i.kind === "COMPLAINT").length, negativeReviewRecent: negative.has(c.id),
      marketingConsent: consent,
      goals: goals.filter((g) => g.status === "ACTIVE").map((g) => ({ id: g.id, name: g.name, targetDate: g.targetDate, progress: g.progress.status })),
      commitments: ins.filter((i) => i.kind === "COMMITMENT" && i.dueAt).map((i) => ({ text: i.text.slice(0, 140), dueAt: i.dueAt! })),
    };
    out.set(c.id, {
      subject, holdings, goals,
      review: reviewStatus({ aum, lastReviewAt: subject.lastReviewAt, createdAt: c.createdAt, now }),
      score: computeAttentionScore(subject, now),
      suggestions: applyDismissals(evaluateRules(subject, now), dismissBy.get(c.id) ?? []),
    });
  }
  return out;
}

export type AttentionRow = {
  clientId: string;
  name: string;
  rmName: string | null;
  score: AttentionScore;
  suggestions: Suggestion[];
  tierLabel: string | null;
};
export type AttentionList = { rows: AttentionRow[]; total: number; counts: { high: number; medium: number }; scanned: number; capped: boolean };

const SCAN_CAP = 500;

/**
 * "Needs attention today" for the viewer. `visibleUserIds` is the same scope the rest of Today uses (null = everyone, otherwise
 * the RM's own id, or a manager's team). Only active customers with an account on file are considered, up to SCAN_CAP.
 */
export async function loadAttentionList(visibleUserIds: string[] | null, now: Date = new Date(), limit = 20): Promise<AttentionList> {
  const candidates = await prisma.client.findMany({
    where: { isDeleted: false, mergedIntoId: null, status: "ACTIVE", tradingAccounts: { some: {} }, ...(visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {}) },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
    take: SCAN_CAP + 1,
  });
  const capped = candidates.length > SCAN_CAP;
  const ids = candidates.slice(0, SCAN_CAP).map((c) => c.id);
  const bundles = await loadOutcomeBundles(ids, now);
  const bandOrder = { high: 2, medium: 1, low: 0 } as const;
  const rows = [...bundles.values()]
    .filter((b) => b.suggestions.length > 0 || b.score.band !== "low")
    .map((b): AttentionRow => ({ clientId: b.subject.clientId, name: b.subject.name, rmName: b.subject.rmName, score: b.score, suggestions: b.suggestions, tierLabel: b.review.tierLabel }))
    .sort((a, b) => bandOrder[b.score.band] - bandOrder[a.score.band] || b.score.score - a.score.score || (b.suggestions[0]?.rank ?? 0) - (a.suggestions[0]?.rank ?? 0) || a.name.localeCompare(b.name));
  return { rows: rows.slice(0, limit), total: rows.length, counts: { high: rows.filter((r) => r.score.band === "high").length, medium: rows.filter((r) => r.score.band === "medium").length }, scanned: ids.length, capped };
}
