import { CountUp, RailCard, RailFact, StickyRail, TabLink } from "@/components/workspace";

import { buildClientRail, type ClientRailInput } from "./client-rail-model";

/**
 * The client record's sticky rail: where the customer is (stage, time in stage, SLA), what to do next, open tickets, the
 * onboarding steps (each a link to the tab that holds it) and the key dates. Server-rendered from data the page already has.
 */
export function ClientRail({ input, tabKeys, fallback }: { input: ClientRailInput; tabKeys: readonly string[]; fallback: string }) {
  const { facts, onboarding, dates } = buildClientRail(input);
  return (
    <StickyRail
      facts={facts.map((f, i) => (
        <RailFact key={f.key} label={f.label} hint={f.hint} tone={f.tone} index={i}>
          {f.count !== undefined ? <CountUp value={f.count} label={f.label} /> : f.value}
        </RailFact>
      ))}
    >
      <RailCard title="Onboarding" labelId="client-rail-onboarding" index={facts.length}>
        <ul className="flex flex-wrap gap-1.5">
          {onboarding.map((c) => (
            <li key={c.key}>
              <TabLink tab={c.tab} keys={tabKeys} fallback={fallback} className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                {c.label.replace(/_/g, " ")}
              </TabLink>
            </li>
          ))}
        </ul>
      </RailCard>
      <RailCard title="Key dates" labelId="client-rail-dates" index={facts.length + 1}>
        <dl className="grid gap-2 text-sm">
          {dates.map((d) => (
            <div key={d.label} className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">{d.label}</dt>
              <dd className="text-right">
                {d.value}
                {d.hint && <span className="block text-xs text-muted-foreground">{d.hint}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </RailCard>
    </StickyRail>
  );
}
