"use server";

import { prisma } from "@/lib/db/prisma";
import { loadClientInScope } from "@/lib/clients/load-in-scope";
import { netRevenue } from "@/lib/marketing/revenue";
import { computeSlaStatus, isReferralLeadSource } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { createTaskAction } from "../tasks/actions";

const CLOSED_OPPORTUNITY_STAGES = ["FUNDED", "INVESTED", "LOST_DEFERRED"] as const;
const ACTIVITY_LIMIT = 20;

/** Everything the client quick view shows — read from the board and the clients list without leaving the page. */
export async function getClientQuickViewAction(clientId: string) {
  const { session, client } = await loadClientInScope(clientId, {
    assignedTo: { select: { id: true, name: true } },
    activities: { include: { user: true }, orderBy: { createdAt: "desc" }, take: ACTIVITY_LIMIT },
    opportunities: { where: { stage: { notIn: [...CLOSED_OPPORTUNITY_STAGES] } }, orderBy: { createdAt: "desc" }, select: { id: true, product: true, stage: true, estimatedValue: true } },
  });
  // Revenue is for the roles that see it elsewhere (Earnings): Admins, among those who can open a client.
  const showRevenue = session.user.role === "ADMIN";
  const now = new Date();
  const [revenueEvents, heldExceptions] = await Promise.all([
    showRevenue
      ? prisma.revenueEvent.findMany({
          where: { clientId },
          select: { id: true, revenueType: true, grossRevenueAmount: true, reversesEventId: true, reverses: { select: { revenueType: true } } },
        })
      : Promise.resolve([]),
    // Time on hold doesn't count against the SLA — the same rule as the clients list and the board.
    prisma.exception.findMany({ where: { clientId, stageId: client.currentStageId }, select: { createdAt: true, resolvedAt: true } }),
  ]);
  const heldMs = heldExceptions.reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
  const opportunities = client.opportunities.map((o) => ({ ...o, estimatedValue: Number(o.estimatedValue) }));

  return {
    role: session.user.role,
    client: {
      id: client.id,
      name: client.name,
      clientCode: client.clientCode,
      mobile: client.mobile,
      email: client.email,
      status: client.status,
      priority: client.priority,
      stageName: client.currentStage.name,
      stageEnteredAt: client.stageEnteredAt,
      slaStatus: isReferralLeadSource(client.leadSource) || client.status !== "ACTIVE" ? "NOT_APPLICABLE" : computeSlaStatus(effectiveStageEnteredAt(client.stageEnteredAt, heldMs), client.currentStage.slaHours, now),
      assignedTo: client.assignedTo,
      expectedInvestment: client.expectedInvestment === null ? null : Number(client.expectedInvestment),
      nextActionTitle: client.nextActionTitle,
      nextActionDueAt: client.nextActionDueAt,
    },
    lastTouchAt: client.activities[0]?.createdAt ?? null,
    opportunities,
    openOpportunityValue: opportunities.reduce((sum, o) => sum + o.estimatedValue, 0),
    lifetimeRevenue: showRevenue
      ? netRevenue(revenueEvents.map((e) => ({ id: e.id, revenueType: e.revenueType, amount: Number(e.grossRevenueAmount), reversesEventId: e.reversesEventId, reversedType: e.reverses?.revenueType ?? null })))
      : null,
    activities: client.activities,
  };
}

export type ClientQuickView = Awaited<ReturnType<typeof getClientQuickViewAction>>;

/** "Schedule a follow-up" from the quick view: the Tasks page's own action, for a client the caller can open, assigned to its RM. */
export async function scheduleFollowUpAction(clientId: string, input: { title: string; dueAt: string }) {
  const { session, client } = await loadClientInScope(clientId, {});
  if (!input.title.trim() || !input.dueAt) throw new Error("A title and a due date are required");
  const formData = new FormData();
  formData.set("clientId", clientId);
  formData.set("title", input.title.trim());
  formData.set("dueAt", input.dueAt);
  formData.set("assignedToId", client.assignedToId ?? session.user.id);
  formData.set("category", "FOLLOW_UP");
  formData.set("source", "quick-view");
  await createTaskAction(formData);
}
