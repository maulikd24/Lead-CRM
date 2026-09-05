import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BlockerBadge } from "@/components/blocker-badge";
import { HygieneWarningBadge } from "@/components/hygiene-badge";
import { StageTracker } from "@/components/stage-tracker";
import { StatCard } from "@/components/shared/stat-card";
import { ClientDetailTabs } from "./client-detail-tabs";
import { computeSlaStatus, stageAgeHours } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { computePriorityScore, computeHealthStatus } from "@/lib/copilot/scoring";
import { getNextBestAction } from "@/lib/copilot/next-best-action";
import { getCrossSellFlags } from "@/lib/copilot/cross-sell";
import { getMilestoneChecklist } from "@/lib/copilot/milestones";
import { suggestMessageTemplate } from "@/lib/copilot/message-suggestion";
import { initials } from "@/lib/utils";
import { CLIENT_STATUS_VARIANT as STATUS_VARIANT, PRIORITY_VARIANT } from "@/lib/status-badge-config";
import type { CopilotClient } from "@/lib/copilot/types";
import { formatStageAge } from "@/lib/utils/format";

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

  const slaTone = slaStatus === "OVERDUE" ? "destructive" : slaStatus === "DUE_SOON" ? "warning" : "success";

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
            <div className="flex items-start gap-3">
              <Avatar className="size-11 shrink-0">
                <AvatarFallback className="font-heading text-sm">{initials(client.name)}</AvatarFallback>
              </Avatar>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-heading text-2xl font-semibold tracking-tight">{client.name}</h1>
                  <span className="font-mono text-sm text-muted-foreground">{client.clientCode}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {client.mobile} · {client.email ?? "no email"} · {client.assignedTo?.name ?? "Unassigned"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:shrink-0">
              <Badge variant={PRIORITY_VARIANT[client.priority]}>{client.priority}</Badge>
              <Badge variant={STATUS_VARIANT[client.status]}>{client.status.replace(/_/g, " ")}</Badge>
              <BlockerBadge reason={openException?.reason} />
              {client.status === "ACTIVE" && !client.nextActionTitle && <HygieneWarningBadge />}
            </div>
          </div>
          <StageTracker stages={stages} currentSequence={client.currentStage.sequence} />
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Current Stage" value={client.currentStage.name} />
        <StatCard label="Time in Stage" value={formatStageAge(ageHours)} tone={slaTone} />
        <StatCard label="SLA Status" value={slaStatus.replace(/_/g, " ")} tone={slaTone} />
      </div>

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
