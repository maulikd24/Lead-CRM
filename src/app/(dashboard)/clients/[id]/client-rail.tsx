import { CountUp, PhoneSheet, RailCard, RailFact, StickyRail } from "@/components/workspace";

import { buildClientRail, type ClientRailInput } from "./client-rail-model";

/**
 * The client record's sticky rail: where the customer is (stage, time in stage, SLA), open tickets and the
 * key dates. Server-rendered from data the page already has.
 */
export function ClientRail({ input }: { input: ClientRailInput }) {
  const { facts, dates } = buildClientRail(input);
  return (
    <StickyRail
      facts={facts.map((f, i) => (
        <RailFact key={f.key} label={f.label} hint={f.hint} tone={f.tone} index={i}>
          {f.count !== undefined ? <CountUp value={f.count} label={f.label} /> : f.value}
        </RailFact>
      ))}
    >
      <PhoneSheet name="rail" title="Key dates" summary="Created, in stage since, last activity">
      <RailCard title="Key dates" labelId="client-rail-dates" index={facts.length}>
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
      </PhoneSheet>
    </StickyRail>
  );
}
