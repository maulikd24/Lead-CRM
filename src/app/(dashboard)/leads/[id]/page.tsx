import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { LeadActionsPanel } from "./lead-actions-panel";
import { LeadTasksPanel } from "./lead-tasks-panel";
import { SendMessagePanel } from "./send-message-panel";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      assignedTo: true,
      activities: { include: { user: true }, orderBy: { createdAt: "desc" } },
      tasks: { orderBy: { dueAt: "asc" } },
    },
  });

  if (!lead) notFound();

  const users = await prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  const templates = await prisma.messageTemplate.findMany({ where: { approved: true } });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 flex flex-col gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-xl">{lead.name}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {lead.email ?? "no email"} · {lead.phone ?? "no phone"}
              </p>
            </div>
            <Badge>{lead.status}</Badge>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline activities={lead.activities} leadId={lead.id} />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <LeadActionsPanel lead={lead} users={users} />
        <SendMessagePanel leadId={lead.id} templates={templates} />
        <LeadTasksPanel lead={lead} tasks={lead.tasks} users={users} />
      </div>
    </div>
  );
}
