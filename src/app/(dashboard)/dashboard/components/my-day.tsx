import Link from "next/link";
import { CalendarCheck } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ListRowSkeleton } from "@/components/shared/skeletons";
import { hasContactRecord } from "@/lib/copilot/types";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";

const BUCKET_DOT: Record<string, string> = {
  Overdue: "bg-destructive",
  "Due Today": "bg-warning",
};

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
        {buckets.length === 0 && (
          <EmptyState icon={CalendarCheck} title="All caught up" description="Nothing needs your attention right now." />
        )}
        {buckets.map((bucket) => (
          <div key={bucket.label} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">{bucket.label}</h3>
              <Badge variant="secondary">{bucket.rows.length}</Badge>
            </div>
            <div className="flex flex-col gap-0.5">
              {bucket.rows.slice(0, 5).map((row, i) => (
                <Link
                  key={`${row.id}-${i}`}
                  href={`/clients/${row.id}`}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-muted"
                >
                  <span className={cn("size-1.5 shrink-0 rounded-full", BUCKET_DOT[bucket.label] ?? "bg-muted-foreground/40")} />
                  <span className="flex-1 truncate">{row.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{row.detail}</span>
                </Link>
              ))}
              {bucket.rows.length > 5 && (
                <p className="px-1.5 text-xs text-muted-foreground">+{bucket.rows.length - 5} more</p>
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
      <CardContent className="flex flex-col gap-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <ListRowSkeleton key={i} />
        ))}
      </CardContent>
    </Card>
  );
}
