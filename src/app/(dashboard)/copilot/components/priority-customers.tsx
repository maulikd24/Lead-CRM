import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { Users } from "lucide-react";

export type PriorityFilters = { priority?: string; owner?: string; timing?: string };

const PRIORITY_VARIANT = { High: "destructive", Medium: "warning", Low: "outline" } as const;
const OWNERS = ["RM", "CRM", "AI Bot", "Support"];
const TIMINGS = ["Today", "This Week", "Later", "Trigger-based"];

function href(filters: PriorityFilters, patch: Partial<PriorityFilters>): string {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `/copilot?${query}` : "/copilot";
}

/** Relationship-wide priority list: who to contact, what to discuss and why — across the whole customer base, not only onboarding. */
export async function PriorityCustomers({ visibleUserIds, includeUnassigned, filters }: { visibleUserIds: string[] | null; includeUnassigned: boolean; filters: PriorityFilters }) {
  const where: Prisma.CustomerIntelligenceWhereInput = {
    nbaPriority: filters.priority && ["High", "Medium", "Low"].includes(filters.priority) ? filters.priority : { in: ["High", "Medium"] },
    ...(filters.owner && OWNERS.includes(filters.owner) ? { nbaOwner: filters.owner } : {}),
    ...(filters.timing && TIMINGS.includes(filters.timing) ? { nbaTiming: filters.timing } : {}),
    client: {
      isDeleted: false,
      mergedIntoId: null,
      status: { not: "NOT_PROCEEDING" },
      ...(visibleUserIds ? { OR: [{ assignedToId: { in: visibleUserIds } }, ...(includeUnassigned ? [{ assignedToId: null }] : [])] } : {}),
    },
  };
  const rows = await prisma.customerIntelligence.findMany({
    where,
    orderBy: [{ priorityScore: "desc" }, { computedAt: "desc" }],
    take: 25,
    include: { client: { select: { id: true, name: true, clientCode: true, assignedTo: { select: { name: true } } } } },
  });

  const chip = (label: string, link: string, active: boolean) => (
    <Link key={label} href={link} className={`rounded-md border px-2 py-0.5 text-xs ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
      {label}
    </Link>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Priority customers</CardTitle>
        <CardDescription>Everyone who needs a conversation, ranked — each with the action, topic and reason.</CardDescription>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs text-muted-foreground">Priority</span>
          {chip("High + Medium", href(filters, { priority: undefined }), !filters.priority)}
          {["High", "Medium", "Low"].map((p) => chip(p, href(filters, { priority: p }), filters.priority === p))}
          <span className="ml-2 text-xs text-muted-foreground">Owner</span>
          {chip("Any", href(filters, { owner: undefined }), !filters.owner)}
          {OWNERS.map((o) => chip(o, href(filters, { owner: o }), filters.owner === o))}
          <span className="ml-2 text-xs text-muted-foreground">When</span>
          {chip("Any", href(filters, { timing: undefined }), !filters.timing)}
          {TIMINGS.map((t) => chip(t, href(filters, { timing: t }), filters.timing === t))}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState icon={Users} title="No customers match" description="Intelligence is computed a few customers at a time in the background — new customers appear within minutes." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Next best action</TableHead>
                <TableHead>Why</TableHead>
                <TableHead>Owner · When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.clientId}>
                  <TableCell>
                    <Link href={`/clients/${row.client.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                      {row.client.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{row.client.clientCode} · {row.client.assignedTo?.name ?? "Unassigned"}</p>
                  </TableCell>
                  <TableCell className="text-sm">{row.lifecycleStage}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={PRIORITY_VARIANT[row.nbaPriority as keyof typeof PRIORITY_VARIANT] ?? "outline"}>{row.nbaPriority}</Badge>
                      <span className="text-sm font-medium">{row.nbaProgramme}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{row.nbaAction}{row.nbaTopic ? ` · ${row.nbaTopic}` : ""}</p>
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal text-sm text-muted-foreground">{row.nbaReason}</TableCell>
                  <TableCell className="text-sm">
                    {row.nbaOwner}
                    <p className="text-xs text-muted-foreground">{row.nbaTiming}</p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
