import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { buildCallRow, canViewCall, type CallRecord, type CallRow } from "./view-model";
import { buildCallDetail, type CallDetail } from "./detail";

/** How far back and how many calls the list loads. Filters and the manager rollup work on this window, so the numbers
 *  on screen always describe exactly the calls that are listed. */
export const CALL_WINDOW_DAYS = 90;
export const CALL_WINDOW_MAX = 500;

function scopeWhere(scope: string[] | null): Prisma.ActivityWhereInput {
  if (scope === null) return {};
  return { OR: [{ userId: { in: scope } }, { conversationReview: { assignedRmId: { in: scope } } }, { client: { assignedToId: { in: scope } } }] };
}

async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

export async function loadCallRows(scope: string[] | null, now: Date): Promise<CallRow[]> {
  const since = new Date(now.getTime() - CALL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const activities = await prisma.activity.findMany({
    where: { type: "CALL", createdAt: { gte: since }, client: { isDeleted: false }, ...scopeWhere(scope) },
    orderBy: { createdAt: "desc" },
    take: CALL_WINDOW_MAX,
    select: {
      id: true,
      createdAt: true,
      payload: true,
      userId: true,
      client: { select: { id: true, name: true, assignedToId: true } },
      conversationReview: { select: { id: true, status: true, qualityScore: true, overriddenScore: true, sentimentLabel: true, reviewedAt: true, assignedRmId: true } },
    },
  });

  const reviewIds = activities.map((a) => a.conversationReview?.id).filter((id): id is string => !!id);
  // Only the presence of a transcript is needed for the list, so do not pull the text itself.
  const withTranscript = new Set(
    reviewIds.length ? (await prisma.conversationReview.findMany({ where: { id: { in: reviewIds }, transcript: { not: null } }, select: { id: true } })).map((r) => r.id) : [],
  );
  const insights = reviewIds.length
    ? await prisma.conversationInsight.findMany({
        where: { sourceType: "CALL", sourceRef: { in: reviewIds }, kind: { in: ["COMPLIANCE_CONCERN", "INCORRECT_INFO", "COMPLAINT", "MISSED_OPPORTUNITY", "COMMITMENT"] } },
        select: { sourceRef: true, kind: true, status: true, dueAt: true },
      })
    : [];
  const insightsByReview = new Map<string, typeof insights>();
  for (const i of insights) insightsByReview.set(i.sourceRef, [...(insightsByReview.get(i.sourceRef) ?? []), i]);

  const rmOf = (a: (typeof activities)[number]) => a.conversationReview?.assignedRmId ?? a.userId ?? a.client.assignedToId ?? null;
  const names = await userNames(activities.map(rmOf));

  return activities.map((a) => {
    const rmId = rmOf(a);
    const r = a.conversationReview;
    const record: CallRecord = {
      activityId: a.id,
      occurredAt: a.createdAt,
      payload: a.payload,
      clientId: a.client.id,
      customerName: a.client.name,
      rmId,
      rmName: rmId ? (names.get(rmId) ?? null) : null,
      review: r ? { id: r.id, status: r.status, hasTranscript: withTranscript.has(r.id), qualityScore: r.qualityScore, overriddenScore: r.overriddenScore, sentimentLabel: r.sentimentLabel, reviewedAt: r.reviewedAt } : null,
      insights: r ? (insightsByReview.get(r.id) ?? []) : [],
    };
    return buildCallRow(record, now);
  });
}

/** Null both when the call does not exist and when the viewer may not see it: the caller cannot tell them apart. */
export async function loadCallDetail(activityId: string, scope: string[] | null, now: Date): Promise<CallDetail | null> {
  const a = await prisma.activity.findFirst({
    where: { id: activityId, type: "CALL", client: { isDeleted: false } },
    select: {
      id: true,
      createdAt: true,
      payload: true,
      userId: true,
      client: { select: { id: true, name: true, assignedToId: true } },
      conversationReview: {
        select: {
          id: true, status: true, transcript: true, sentimentLabel: true, sentimentReasoning: true, qualityScore: true, overriddenScore: true, qualityBreakdown: true,
          recommendationText: true, failureReason: true, reviewedAt: true, reviewNotes: true, assignedRmId: true,
          reviewedBy: { select: { name: true } },
          task: { select: { id: true, title: true, status: true, dueAt: true } },
        },
      },
    },
  });
  if (!a) return null;
  const review = a.conversationReview;
  const rmId = review?.assignedRmId ?? a.userId ?? a.client.assignedToId ?? null;
  if (!canViewCall(scope, { rmId: review?.assignedRmId ?? null, activityUserId: a.userId, clientAssignedToId: a.client.assignedToId })) return null;

  const [names, insights] = await Promise.all([
    userNames([rmId]),
    review
      ? prisma.conversationInsight.findMany({ where: { sourceType: "CALL", sourceRef: review.id }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, text: true, status: true, dueAt: true, severity: true } })
      : Promise.resolve([]),
  ]);

  return buildCallDetail(
    {
      activityId: a.id,
      occurredAt: a.createdAt,
      payload: a.payload,
      customerName: a.client.name,
      clientId: a.client.id,
      rmId,
      rmName: rmId ? (names.get(rmId) ?? null) : null,
      review: review
        ? {
            id: review.id, status: review.status, transcript: review.transcript, sentimentLabel: review.sentimentLabel, sentimentReasoning: review.sentimentReasoning,
            qualityScore: review.qualityScore, overriddenScore: review.overriddenScore, qualityBreakdown: review.qualityBreakdown, recommendationText: review.recommendationText,
            failureReason: review.failureReason, reviewedAt: review.reviewedAt, reviewedByName: review.reviewedBy?.name ?? null, reviewNotes: review.reviewNotes, task: review.task,
          }
        : null,
      insights,
    },
    now,
  );
}

/** RMs offered in the filter: everyone in scope who appears on a loaded call. */
export function rmOptions(rows: CallRow[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows) if (r.rmId) seen.set(r.rmId, r.rmName ?? "Unknown");
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
