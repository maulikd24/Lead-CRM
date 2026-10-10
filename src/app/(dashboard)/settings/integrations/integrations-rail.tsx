import Link from "next/link";

import { CountUp, PhoneSheet, RailCard, RailFact, StickyRail, tabHref } from "@/components/workspace";
import { INTEGRATION_GROUPS, summarise, type StatusRow } from "@/lib/integrations/overview";
import { StateBadge } from "./status-badge";

/** Counts and a per-integration list: connected, mock mode, needs setup, flag off. Each row opens the tab that holds the card. */
export function IntegrationsRail({ rows }: { rows: StatusRow[] }) {
  const counts = summarise(rows);
  return (
    <StickyRail
      label="Integration status"
      facts={
        <>
          <RailFact label="Connected" tone="success" index={0}><CountUp value={counts.connected} label="Connected" /></RailFact>
          <RailFact label="Mock mode" index={1}><CountUp value={counts.mock} label="Mock mode" /></RailFact>
          <RailFact label="Needs setup" tone={counts.needs_setup > 0 ? "warning" : "default"} index={2}><CountUp value={counts.needs_setup} label="Needs setup" /></RailFact>
          <RailFact label="Flag off" index={3}><CountUp value={counts.flag_off} label="Flag off" /></RailFact>
        </>
      }
    >
      <PhoneSheet name="all-integrations" title="All integrations" summary={`${rows.length} across ${INTEGRATION_GROUPS.length} groups`}>
      <RailCard title="All integrations" labelId="integ-all" index={4}>
        <div className="flex flex-col gap-3">
          {INTEGRATION_GROUPS.map((g) => (
            <div key={g.key}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{g.label}</p>
              <ul className="flex flex-col gap-1">
                {rows.filter((r) => r.group === g.key).map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <Link href={tabHref("/settings/integrations", "", g.key, { fallback: "messaging" })} className="block truncate underline-offset-4 hover:underline">{r.label}</Link>
                      {r.detail && <span className="block truncate font-mono text-[0.7rem] text-muted-foreground">{r.detail}</span>}
                    </span>
                    <StateBadge state={r.state} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </RailCard>
      </PhoneSheet>
    </StickyRail>
  );
}
