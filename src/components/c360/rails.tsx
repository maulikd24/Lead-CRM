import { cache } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StickyRail } from "@/components/workspace";
import { loadLeftRail, loadRightRail, loadTimeline } from "@/lib/c360/loaders";
import type { C360TabKey } from "@/lib/c360/tabs";
import { OutcomesSection } from "@/components/outcomes/outcomes-section";

import { RailError } from "./rail-views";
import { TimelineView } from "./timeline-view";
import { ConsentChipView, ConsentPanelView, OverviewPanelView, PortfolioPanelView, RailSummary, TicketsPanelView, type RightRailFull } from "./workspace-views";

// One async server component for the rail and one for the section on screen, each behind its own <Suspense> in the page:
// a slow or failing half never blocks or breaks the other. `clientId` is already authorised by the page. The loaders are
// wrapped in `cache`, so the rail and the section share one query per request.

const log = (what: string, error: unknown) => console.error(`Customer 360: ${what} failed`, error instanceof Error ? error.name : "unknown");

const getLeft = cache((clientId: string) => loadLeftRail(clientId).catch((error) => (log("portfolio", error), null)));
const getRight = cache((clientId: string) => loadRightRail(clientId, new Date()).catch((error) => (log("summary", error), null)) as Promise<RightRailFull | null>);
const getTimeline = cache((clientId: string) => loadTimeline(clientId).catch((error) => (log("timeline", error), null)));

/** The sticky rail: next step, open tickets, consent, portfolio ring, acceptance chips and key dates. */
export async function C360Rail({ clientId, tab }: { clientId: string; tab: C360TabKey }) {
  const [left, right] = await Promise.all([getLeft(clientId), getRight(clientId)]);
  if (!left && !right) return <StickyRail label="Key facts and next action"><RailError what="the customer summary" /></StickyRail>;
  return <RailSummary clientId={clientId} left={left} right={right} tab={tab} />;
}

async function TimelineSection({ clientId }: { clientId: string }) {
  const timeline = await getTimeline(clientId);
  if (!timeline) return <RailError what="the timeline" />;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <TimelineView events={timeline.events} olderNotShown={timeline.olderNotShown} nowIso={new Date().toISOString()} />
      </CardContent>
    </Card>
  );
}

/** The one section on screen. Only the data this tab needs is loaded. */
export async function C360Section({ clientId, tab, canEditOutcomes = false }: { clientId: string; tab: C360TabKey; canEditOutcomes?: boolean }) {
  if (tab === "outcomes") return <OutcomesSection clientId={clientId} canEdit={canEditOutcomes} />;
  if (tab === "timeline") return <TimelineSection clientId={clientId} />;
  if (tab === "portfolio") {
    const left = await getLeft(clientId);
    return left ? <PortfolioPanelView left={left} /> : <RailError what="the portfolio" />;
  }
  const right = await getRight(clientId);
  if (!right) return <RailError what="the customer summary" />;
  if (tab === "consent") return <ConsentPanelView clientId={clientId} consent={right.consent} />;
  if (tab === "tickets") {
    const timeline = await getTimeline(clientId);
    const calls = (timeline?.events ?? []).filter((e) => e.kind === "call").slice(0, 10);
    return <TicketsPanelView clientId={clientId} tickets={right.tickets} issues={right.issues} calls={calls} />;
  }
  return <OverviewPanelView right={right} />;
}

/** Marketing-consent chip for the header, from the same cached summary the rail uses. */
export async function ConsentChip({ clientId }: { clientId: string }) {
  const right = await getRight(clientId);
  if (!right) return null;
  return <ConsentChipView marketing={right.consent.marketing} />;
}
