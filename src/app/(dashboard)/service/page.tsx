import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { c360TabHref } from "@/lib/c360/tabs";
import { serviceStateEnabled } from "@/lib/memory/flag";
import { ageLabel } from "@/lib/freshness/stale";
import { getServiceQueue } from "@/lib/service/read";

export const metadata = { title: "Complaints and promises" };

const SEVERITY_VARIANT = { CRITICAL: "destructive", HIGH: "destructive", MEDIUM: "warning", LOW: "secondary" } as const;
const SLA_TEXT = { ok: "Within its deadline", at_risk: "Deadline close", breached: "Deadline missed", met: "Met", missed: "Missed" } as const;
const SLA_VARIANT = { ok: "secondary", at_risk: "warning", breached: "destructive", met: "success", missed: "destructive" } as const;

/** Open complaints and overdue promises across the customers the viewer may see: an RM their own, a manager their team, an admin everyone. */
export default async function ServicePage() {
  const session = await requireAccess("service-state");
  if (!serviceStateEnabled()) notFound();
  const now = new Date();
  const queue = await getServiceQueue({ userId: session.user.id, role: session.user.role }, now);
  if (!queue) notFound();
  const team = session.user.role !== "RM";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Complaints and promises" description={`${team ? "Across your team" : "Your customers"}: complaints that are open and promises that are late. As of ${ageLabel(now, now)}.`} />

      <Card role="region" aria-labelledby="svc-open-complaints">
        <CardHeader>
          <CardTitle id="svc-open-complaints" className="text-base">Open complaints <span className="font-normal text-muted-foreground">({queue.complaints.length})</span></CardTitle>
          <CardDescription>Missed deadlines first, then by deadline.</CardDescription>
        </CardHeader>
        <CardContent>
          {queue.complaints.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No open complaints.</p>
          ) : (
            <ul className="divide-y divide-border">
              {queue.complaints.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5">
                  <div className="min-w-0">
                    <Link href={c360TabHref(c.clientId, "service")} className="text-sm font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{c.title}</Link>
                    <p className="text-xs text-muted-foreground">{c.clientName} <span className="font-mono">{c.clientCode}</span>. Opened {c.openedAgo}.{c.ackState === "overdue" ? " Not acknowledged." : ""}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={SEVERITY_VARIANT[c.severity]}>{c.severity.toLowerCase()}</Badge>
                    <Badge variant="outline">{c.status.replace("_", " ").toLowerCase()}</Badge>
                    <Badge variant={SLA_VARIANT[c.slaState]}>{SLA_TEXT[c.slaState]}</Badge>
                    {c.reopened && <Badge variant="warning">Reopened</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card role="region" aria-labelledby="svc-overdue">
        <CardHeader>
          <CardTitle id="svc-overdue" className="text-base">Overdue promises <span className="font-normal text-muted-foreground">({queue.commitments.length})</span></CardTitle>
          <CardDescription>Accepted promises that are past their date, longest overdue first. Suggestions read from conversations are not counted until someone accepts them.</CardDescription>
        </CardHeader>
        <CardContent>
          {queue.commitments.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No overdue promises.</p>
          ) : (
            <ul className="divide-y divide-border">
              {queue.commitments.map((m) => (
                <li key={m.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5">
                  <div className="min-w-0">
                    <Link href={c360TabHref(m.clientId, "service")} className="text-sm font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{m.text}</Link>
                    <p className="text-xs text-muted-foreground">{m.clientName} <span className="font-mono">{m.clientCode}</span>. Due {new Date(m.dueAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}.</p>
                  </div>
                  <Badge variant="destructive">Overdue by {m.overdueBy}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
