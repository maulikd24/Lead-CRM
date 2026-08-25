import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { StageTracker } from "@/components/stage-tracker";
import { ClientActionsPanel } from "./client-actions-panel";
import { ClientTasksPanel } from "./client-tasks-panel";
import { SendMessagePanel } from "./send-message-panel";
import { StageActionCard } from "./stage-action-card";
import { formatDateTime } from "@/lib/utils/format";

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

  const [client, visibleUserIds, users, templates, stages] = await Promise.all([
    prisma.client.findUnique({
      where: { id },
      include: {
        assignedTo: true,
        currentStage: true,
        documents: { orderBy: { createdAt: "asc" } },
        kycRecord: true,
        fundingRecord: true,
        dealerIntroduction: true,
        activities: { include: { user: true }, orderBy: { createdAt: "desc" }, take: 50 },
        tasks: { orderBy: { dueAt: "asc" } },
      },
    }),
    getVisibleUserIds(session.user.id, session.user.role),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.messageTemplate.findMany({ where: { approved: true } }),
    prisma.stage.findMany({ orderBy: { sequence: "asc" } }),
  ]);

  if (!client) notFound();
  if (visibleUserIds && (!client.assignedToId || !visibleUserIds.includes(client.assignedToId))) {
    notFound();
  }

  const canOverride = session.user.role === "ADMIN" || session.user.role === "MANAGER";

  // Prisma's Decimal fields aren't plain-serializable across the Server->Client Component
  // boundary — convert to plain numbers before passing down to any "use client" component.
  const serializedClient = {
    ...client,
    expectedInvestment: client.expectedInvestment ? Number(client.expectedInvestment) : null,
    fundingRecord: client.fundingRecord
      ? { ...client.fundingRecord, amount: client.fundingRecord.amount ? Number(client.fundingRecord.amount) : null }
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
            </div>
          </div>
          <StageTracker stages={stages} currentSequence={client.currentStage.sequence} />
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <StageActionCard client={serializedClient} canOverride={canOverride} />

          {client.documents.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Documents</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {client.documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between text-sm">
                    <span>
                      {doc.documentType}
                      {doc.mandatory && <span className="text-destructive"> *</span>}
                    </span>
                    <Badge variant={doc.status === "REJECTED" ? "destructive" : doc.status === "VERIFIED" ? "default" : "outline"}>
                      {doc.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline activities={client.activities} clientId={client.id} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <ClientActionsPanel client={serializedClient} users={users} currentUserRole={session.user.role} />
          <SendMessagePanel clientId={client.id} templates={templates} />
          <ClientTasksPanel client={serializedClient} tasks={client.tasks} users={users} />
          <p className="text-xs text-muted-foreground px-1">
            Created {formatDateTime(client.createdAt)} by stage engine
          </p>
        </div>
      </div>
    </div>
  );
}
