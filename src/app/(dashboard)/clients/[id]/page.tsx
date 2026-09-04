import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BlockerBadge } from "@/components/blocker-badge";
import { HygieneWarningBadge } from "@/components/hygiene-badge";
import { StageTracker } from "@/components/stage-tracker";
import { ClientDetailTabs } from "./client-detail-tabs";
import { computeSlaStatus, stageAgeHours } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { computePriorityScore, computeHealthStatus } from "@/lib/copilot/scoring";
import { getNextBestAction } from "@/lib/copilot/next-best-action";
import { getCrossSellFlags } from "@/lib/copilot/cross-sell";
import { getMilestoneChecklist } from "@/lib/copilot/milestones";
import { suggestMessageTemplate } from "@/lib/copilot/message-suggestion";
import type { CopilotClient } from "@/lib/copilot/types";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ACTIVE: "default",
  ON_HOLD: "secondary",
  COMPLETED: "default",
  NOT_PROCEEDING: "destructive",
};

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  HIGH: "destructive",
  MEDIUM: "secondary",
  LOW: "outline",
};

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireUser();
  const { id } = await params;

  const [client, visibleUserIds, users, templates, stages, exceptions, auditLogs] = await Promise.all([
    prisma.client.findUnique({
      where: { id },
      include: {
        assignedTo: true,
        currentStage: true,
        documents: { orderBy: { createdAt: "asc" }, take: 50 },
        kycRecord: true,
        fundingRecord: true,
        dealerIntroduction: true,
        activities: { include: { user: true }, orderBy: { createdAt: "desc" }, take: 50 },
        tasks: { orderBy: { dueAt: "asc" }, take: 50 },
      },
    }),
    getVisibleUserIds(session.user.id, session.user.role),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.messageTemplate.findMany({ where: { approved: true } }),
    prisma.stage.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" } }),
    prisma.exception.findMany({
      where: { clientId: id },
      select: { stageId: true, reason: true, status: true, createdAt: true, resolvedAt: true },
    }),
    prisma.auditLog.findMany({
      where: { entity: "Client", entityId: id },
      include: { user: true },
      orderBy: { timestamp: "desc" },
    }),
  ]);

  if (!client) notFound();
  if (visibleUserIds && (!client.assignedToId || !visibleUserIds.includes(client.assignedToId))) {
    notFound();
  }

  const canOverride = session.user.role === "ADMIN" || session.user.role === "MANAGER";

  const now = new Date();
  const heldMs = exceptions
    .filter((e) => e.stageId === client.currentStageId)
    .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
  const effectiveEnteredAt = effectiveStageEnteredAt(client.stageEnteredAt, heldMs);
  const slaStatus = computeSlaStatus(effectiveEnteredAt, client.currentStage.slaHours, now);
  const ageHours = stageAgeHours(effectiveEnteredAt, now);
  const daysSinceLastActivity = client.activities[0]
    ? Math.floor((now.getTime() - client.activities[0].createdAt.getTime()) / (1000 * 60 * 60 * 24))
    : Math.floor((now.getTime() - client.createdAt.getTime()) / (1000 * 60 * 60 * 24));
  const overdueTaskCount = client.tasks.filter((t) => t.status === "OVERDUE").length;
  const openException = exceptions.find((e) => e.status === "OPEN");

  const copilotClient: CopilotClient = client;
  const priorityScore = computePriorityScore({
    priority: client.priority,
    slaStatus,
    overdueTaskCount,
    daysSinceLastActivity,
    clientStatus: client.status,
  });
  const healthResult = computeHealthStatus({
    slaStatus,
    stageAgeHours: ageHours,
    benchmarkAvgHours: null,
    daysSinceLastActivity,
  });
  const nba = getNextBestAction(copilotClient);
  const crossSellFlags = getCrossSellFlags(client);
  const milestones = getMilestoneChecklist(copilotClient, stages);
  const messageSuggestion = suggestMessageTemplate(nba, { ...copilotClient, assignedTo: client.assignedTo }, templates);
  const suggestedFollowUp = { title: nba.label, dueAtIso: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString() };

  // Prisma's Decimal fields aren't plain-serializable across the Server->Client Component
  // boundary — convert to plain numbers before passing down to any "use client" component.
  const serializedClient = {
    ...client,
    expectedInvestment: client.expectedInvestment ? Number(client.expectedInvestment) : null,
    fundingRecord: client.fundingRecord
      ? { ...client.fundingRecord, amount: client.fundingRecord.amount ? Number(client.fundingRecord.amount) : null }
      : null,
    dealerIntroduction: client.dealerIntroduction
      ? {
          ...client.dealerIntroduction,
          maxOrderValue: client.dealerIntroduction.maxOrderValue ? Number(client.dealerIntroduction.maxOrderValue) : null,
          maxExposureLimit: client.dealerIntroduction.maxExposureLimit
            ? Number(client.dealerIntroduction.maxExposureLimit)
            : null,
        }
      : null,
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-row items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-xl">{client.name}</CardTitle>
                <span className="text-sm text-muted-foreground font-mono">{client.clientCode}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {client.mobile} · {client.email ?? "no email"} · {client.assignedTo?.name ?? "Unassigned"}
              </p>
            </div>
            <div className="flex gap-2">
              <Badge variant={PRIORITY_VARIANT[client.priority]}>{client.priority}</Badge>
              <Badge variant={STATUS_VARIANT[client.status]}>{client.status.replace(/_/g, " ")}</Badge>
              <BlockerBadge reason={openException?.reason} />
              {client.status === "ACTIVE" && !client.nextActionTitle && <HygieneWarningBadge />}
            </div>
          </div>
          <StageTracker stages={stages} currentSequence={client.currentStage.sequence} />
        </CardHeader>
      </Card>

      <ClientDetailTabs
        client={serializedClient}
        auditLogs={auditLogs}
        users={users}
        templates={templates}
        stages={stages}
        canOverride={canOverride}
        currentUserRole={session.user.role}
        tasks={client.tasks}
        priorityScore={priorityScore}
        healthResult={healthResult}
        nba={nba}
        crossSellFlags={crossSellFlags}
        milestones={milestones}
        messageSuggestion={messageSuggestion}
        suggestedFollowUp={suggestedFollowUp}
      />
    </div>
  );
}
