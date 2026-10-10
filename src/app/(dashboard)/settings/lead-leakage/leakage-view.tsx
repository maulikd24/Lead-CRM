import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MasterDetail, PhoneSheet, ShowFirst, type MasterItem } from "@/components/workspace";
import { formatDuration } from "@/lib/attribution/journey";
import type { Leakage } from "@/lib/attribution/leakage";
import { formatPercent } from "@/lib/marketing/view-model";

/** Leads nobody reached past their SLA, by campaign. Pick a campaign on the left, see the leads and how long each has waited on the right. */
export function LeakageView({ leakage, slaMinutes, windowLabel }: { leakage: Leakage; slaMinutes: number; windowLabel: string }) {
  if (leakage.total === 0) {
    return (
      <Card role="region" aria-labelledby="leak-empty">
        <CardHeader>
          <CardTitle id="leak-empty" className="font-heading text-base">No leaked leads</CardTitle>
          <CardDescription>Every lead from {windowLabel} was reached within {slaMinutes} minutes or is still inside its window.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const items: MasterItem[] = leakage.groups.map((g) => ({
    id: g.key,
    title: g.label,
    meta: `${formatPercent(g.leakRate)} of reached or missed leads · ${formatDuration(g.oldestMinutesPastSla * 60_000)} oldest`,
    trailing: <Badge variant="destructive">{g.missed}</Badge>,
  }));
  const details = Object.fromEntries(
    leakage.groups.map((g) => [
      g.key,
      <div key={g.key} className="flex flex-col gap-3 p-1 text-sm">
        <div>
          <p className="font-heading text-base font-semibold">{g.label}</p>
          <p className="text-muted-foreground">{g.missed} of {g.leads} leads were never reached. The longest has waited {formatDuration(g.oldestMinutesPastSla * 60_000)} past the {slaMinutes} minute SLA.</p>
        </div>
        <ShowFirst
          name={`leak-${g.key}`}
          title={`Leaked leads: ${g.label}`}
          noun="leads"
          limit={5}
          items={g.items.map((i) => (
            <div key={i.clientId} className="flex items-start justify-between gap-3 rounded-md border border-border p-2.5">
              <div className="min-w-0">
                <Link href={`/clients/${i.clientId}/360?tab=journey`} className="break-words font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{i.name}</Link>
                <p className="text-xs text-muted-foreground">{i.stage} · RM {i.rmName ?? "unassigned"} · lead on {i.leadDate}</p>
              </div>
              <Badge variant="destructive" className="shrink-0">{formatDuration(i.minutesPastSla * 60_000)} past</Badge>
            </div>
          ))}
        />
      </div>,
    ]),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <MasterDetail idPrefix="leak" label="Campaigns with leaked leads" items={items} details={details} noun="campaigns" />
      <PhoneSheet name="leak-by-rm" title="By relationship manager" summary={`${leakage.byRm.length} ${leakage.byRm.length === 1 ? "person" : "people"} with leaked leads`}>
        <Card role="region" aria-labelledby="leak-rm">
          <CardHeader>
            <CardTitle id="leak-rm" className="text-base">By relationship manager</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 text-sm">
              {leakage.byRm.map((r) => (
                <li key={r.rmName} className="flex items-center justify-between gap-3">
                  <span>{r.rmName}</span>
                  <span className="tabular-nums text-muted-foreground">{r.missed}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </PhoneSheet>
    </div>
  );
}
