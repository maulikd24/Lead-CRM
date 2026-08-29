import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { hasContactRecord } from "@/lib/copilot/types";
import { formatDateTime } from "@/lib/utils/format";
import type { Prisma } from "@/generated/prisma/client";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

type Bucket = { label: string; rows: { id: string; name: string; detail: string }[] };

export async function MyDay({
  clientFilter,
  taskFilter,
}: {
  clientFilter: Prisma.ClientWhereInput;
  taskFilter: Prisma.TaskWhereInput;
}) {
  const today = startOfToday();
  const tomorrow = new Date(today.getTime() + 86400000);
  const now = new Date();

  const [overdueTasks, dueTodayTasks, newLeads, kycStage, fundingCandidates, dealerCandidates, hygieneClients] =
    await Promise.all([
      prisma.task.findMany({
        where: { ...taskFilter, status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: now } },
        include: { client: true },
        orderBy: { dueAt: "asc" },
        take: 20,
      }),
      prisma.task.findMany({
        where: { ...taskFilter, status: "PENDING", dueAt: { gte: today, lt: tomorrow } },
        include: { client: true },
        orderBy: { dueAt: "asc" },
        take: 20,
      }),
      prisma.client.findMany({
        where: { ...clientFilter, status: "ACTIVE", currentStage: { name: "New Lead" } },
        include: { activities: { select: { type: true, payload: true } } },
        take: 50,
      }),
      prisma.client.findMany({
        where: { ...clientFilter, status: "ACTIVE", currentStage: { name: "Submitted for KYC" } },
        take: 20,
      }),
      prisma.client.findMany({
        where: { ...clientFilter, status: "ACTIVE", currentStage: { name: "KYC completed" } },
        take: 20,
      }),
      prisma.client.findMany({
        where: {
          ...clientFilter,
          status: "ACTIVE",
          currentStage: { name: { in: ["Pushed for funds", "Introduction with Dealer"] } },
          dealerIntroduction: { isNot: { status: "COMPLETED" } },
        },
        take: 20,
      }),
      prisma.client.findMany({
        where: { ...clientFilter, status: "ACTIVE", nextActionTitle: null },
        take: 20,
      }),
    ]);

  const notContactedLeads = newLeads.filter((c) => !hasContactRecord(c.activities));

  const buckets: Bucket[] = [
    {
      label: "Overdue",
      rows: overdueTasks.map((t) => ({ id: t.clientId, name: t.client.name, detail: `${t.title} — ${formatDateTime(t.dueAt)}` })),
    },
    {
      label: "Due Today",
      rows: dueTodayTasks.map((t) => ({ id: t.clientId, name: t.client.name, detail: t.title })),
    },
    {
      label: "New Leads Not Contacted",
      rows: notContactedLeads.map((c) => ({ id: c.id, name: c.name, detail: "No contact recorded yet" })),
    },
    {
      label: "KYC Follow-ups",
      rows: kycStage.map((c) => ({ id: c.id, name: c.name, detail: "Awaiting KYC completion" })),
    },
    {
      label: "Funding Pending",
      rows: fundingCandidates.map((c) => ({ id: c.id, name: c.name, detail: "Awaiting funding" })),
    },
    {
      label: "Dealer Intros Pending",
      rows: dealerCandidates.map((c) => ({ id: c.id, name: c.name, detail: "Dealer introduction not completed" })),
    },
    {
      label: "CRM Hygiene",
      rows: hygieneClients.map((c) => ({ id: c.id, name: c.name, detail: "No next action set" })),
    },
  ].filter((b) => b.rows.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>My Day</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {buckets.length === 0 && <p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>}
        {buckets.map((bucket) => (
          <div key={bucket.label} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">{bucket.label}</h3>
              <Badge variant="secondary">{bucket.rows.length}</Badge>
            </div>
            <div className="flex flex-col gap-1">
              {bucket.rows.slice(0, 5).map((row, i) => (
                <Link
                  key={`${row.id}-${i}`}
                  href={`/clients/${row.id}`}
                  className="flex items-center justify-between text-sm hover:underline"
                >
                  <span>{row.name}</span>
                  <span className="text-xs text-muted-foreground">{row.detail}</span>
                </Link>
              ))}
              {bucket.rows.length > 5 && (
                <p className="text-xs text-muted-foreground">+{bucket.rows.length - 5} more</p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function MyDaySkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>My Day</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-6 w-full animate-pulse rounded-md bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}
