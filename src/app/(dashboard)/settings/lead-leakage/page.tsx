import { notFound } from "next/navigation";

import { RailFact, StickyRail, TabbedWorkspace, CountUp } from "@/components/workspace";

import { requireMarketing } from "@/lib/auth/require-role";
import { loadSettings } from "@/lib/attribution/db";
import { attributionEnabled } from "@/lib/attribution/flag";
import { loadImpact } from "@/lib/attribution/impact-db";
import { formatDuration } from "@/lib/attribution/journey";
import { buildLeakage } from "@/lib/attribution/leakage";
import { getWorkspaceClock } from "@/lib/marketing/report";
import { parseRange } from "@/lib/marketing/view-model";

import { LeakageView } from "./leakage-view";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead leakage" };

const TABS = [
  { key: "leakage", label: "Leakage" },
  { key: "settings", label: "SLA settings" },
] as const;

/** Admin: leads nobody reached past their SLA, by campaign, and the SLA itself. */
export default async function LeadLeakagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireMarketing("marketing-attribution");
  if (!attributionEnabled()) notFound();
  const params = await searchParams;
  const clock = await getWorkspaceClock((today) => parseRange({ range: "30d", ...params, tab: undefined }, today));
  const [impact, settings] = await Promise.all([loadImpact(clock.range, { id: session.user.id, role: session.user.role }), loadSettings()]);
  const leakage = buildLeakage({ report: impact.report, customers: impact.customers, slaMinutes: impact.slaMinutes, now: new Date() });
  const windowLabel = `${clock.range.from} to ${clock.range.to}`;
  const worst = leakage.groups[0];

  return (
    <TabbedWorkspace
      idPrefix="leak-ws"
      label="Lead leakage sections"
      tabs={[...TABS]}
      header={
        <div>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">Lead leakage</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">Leads nobody reached within {impact.slaMinutes} minutes, by campaign, for {windowLabel}. Read-only: nothing is sent to anyone.</p>
        </div>
      }
      rail={
        <StickyRail
          label="Leakage key facts"
          facts={[
            <RailFact key="leaked" label="Leaked leads" index={0} tone={leakage.total > 0 ? "destructive" : "success"} hint={`In the last ${clock.range.preset === "custom" ? "range" : clock.range.preset}`}><CountUp value={leakage.total} label="Leaked leads" /></RailFact>,
            <RailFact key="oldest" label="Longest wait" index={1} hint="Past the SLA">{worst ? formatDuration(worst.oldestMinutesPastSla * 60_000) : "None"}</RailFact>,
            <RailFact key="worst" label="Most affected" index={2} hint={worst ? `${worst.missed} leads` : undefined}>{worst ? worst.label : "No campaign"}</RailFact>,
          ]}
        />
      }
      panels={{ leakage: <LeakageView leakage={leakage} slaMinutes={impact.slaMinutes} windowLabel={windowLabel} />, settings: <SettingsForm initial={settings} /> }}
    />
  );
}
