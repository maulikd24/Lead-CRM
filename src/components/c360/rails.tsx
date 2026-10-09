import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadLeftRail, loadRightRail, loadTimeline } from "@/lib/c360/loaders";

import { TimelineView } from "./timeline-view";
import { AcceptanceCardView, CommitmentsCardView, ConsentCardView, KeyDatesCardView, NextActionCardView, PortfolioCardView, RailError, TicketsPlaceholderCard } from "./rail-views";

// One async server component per rail, each wrapped in its own <Suspense> by the page: a slow or failing rail never
// blocks or breaks the others. `clientId` is already authorised by the page.

export async function TimelineRail({ clientId }: { clientId: string }) {
  let events: Awaited<ReturnType<typeof loadTimeline>>;
  try {
    events = await loadTimeline(clientId);
  } catch (error) {
    console.error("Customer 360: timeline failed", error instanceof Error ? error.name : "unknown");
    return <RailError what="the timeline" />;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <TimelineView events={events} nowIso={new Date().toISOString()} />
      </CardContent>
    </Card>
  );
}

export async function LeftRail({ clientId }: { clientId: string }) {
  let data: Awaited<ReturnType<typeof loadLeftRail>>;
  try {
    data = await loadLeftRail(clientId);
  } catch (error) {
    console.error("Customer 360: portfolio failed", error instanceof Error ? error.name : "unknown");
    return <RailError what="the portfolio" />;
  }
  return (
    <>
      <PortfolioCardView data={data} />
      <AcceptanceCardView chips={data.chips} />
    </>
  );
}

export async function RightRail({ clientId }: { clientId: string }) {
  let data: Awaited<ReturnType<typeof loadRightRail>>;
  try {
    data = await loadRightRail(clientId, new Date());
  } catch (error) {
    console.error("Customer 360: summary failed", error instanceof Error ? error.name : "unknown");
    return <RailError what="the customer summary" />;
  }
  if (!data) return <RailError what="the customer summary" />;
  return (
    <>
      <NextActionCardView nba={data.nba} available={data.intelligenceAvailable} />
      <CommitmentsCardView commitments={data.commitments} />
      <KeyDatesCardView keyDates={data.keyDates} />
      <TicketsPlaceholderCard openIssues={data.issues} />
      <ConsentCardView consent={data.consent} />
    </>
  );
}
