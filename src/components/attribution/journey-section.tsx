import { cache } from "react";

import { RailError } from "@/components/c360/rail-views";
import { loadClientJourney } from "@/lib/attribution/db";

import { JourneySteps, JourneySummary } from "./journey-view";

// `clientId` was authorised by the Customer 360 page (same rule as every other tab); this adds no data path of its own.
const getJourney = cache((clientId: string) =>
  loadClientJourney(clientId).catch((error) => {
    console.error("Customer 360: journey failed", error instanceof Error ? error.name : "unknown");
    return null;
  }),
);

/** The Journey tab: where the customer came from, and every step from lead to revenue, dated and measured. */
export async function JourneySection({ clientId }: { clientId: string }) {
  const data = await getJourney(clientId);
  if (!data) return <RailError what="the journey" />;
  const created = data.journey.steps.find((s) => s.key === "lead_created")?.at ?? new Date();
  const dueAtIso = new Date(created.getTime() + data.settings.slaMinutes * 60_000).toISOString();
  return (
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <JourneySummary journey={data.journey} attribution={data.attribution} />
      <JourneySteps journey={data.journey} dueAtIso={dueAtIso} nowIso={new Date().toISOString()} />
    </div>
  );
}
