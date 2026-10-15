import Link from "next/link";
import { Handshake, Phone, Sparkles, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { CountUp as WsCountUp, PhoneSheet, RailCard as WsRailCard, RailFact, ShowFirst, StickyRail } from "@/components/workspace";
import type { IntelligenceView } from "@/lib/intelligence/view";
import type { TicketsView } from "@/lib/c360/tickets";
import { formatClock, type TimelineEvent } from "@/lib/c360/timeline";

import { KeyDatesTrack } from "./key-dates-track";
import { NextBestActionHero } from "./next-best-action-hero";
import { PortfolioRing } from "./portfolio-ring";
import {
  AcceptanceCardView,
  AcceptanceChips,
  asOf,
  CommitmentsCardView,
  ConsentCardView,
  Empty,
  KeyDatesCardView,
  PortfolioCardView,
  RailCard,
  TicketsCardView,
  type LeftRailData,
  type RightRailData,
} from "./rail-views";

/** What the right-rail loader returns (rail-views' shape plus the ticket summary). */
export type RightRailFull = RightRailData & { tickets: TicketsView };

const CONSENT_LABEL: Record<RightRailData["consent"]["marketing"], { text: string; tone: "default" | "success" | "warning" | "destructive" }> = {
  given: { text: "Given", tone: "success" },
  withdrawn: { text: "Withdrawn", tone: "default" },
  expired: { text: "Expired", tone: "default" },
  do_not_contact: { text: "Do not contact", tone: "destructive" },
  not_recorded: { text: "Not recorded", tone: "default" },
};

/** The one warning on the header status line: a warning icon and the plain words, red, only when consent blocks something. */
export function StatusWarning({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium text-destructive" data-testid="status-warning">
      <TriangleAlert aria-hidden className="size-3.5" />
      {text}
    </span>
  );
}

/**
 * The rail: facts only (the next action is the hero on the Overview). RM, open tickets and consent are the facts (a swipeable
 * strip on a phone); the portfolio ring, acceptance chips and key dates are the blocks (minus whichever the section on screen
 * already shows in full). Either half may be missing (a half
 * that failed to load is simply left out; the section panel shows the error).
 */
export function RailSummary({ clientId, left, right, tab, rm }: { clientId: string; left: LeftRailData | null; right: RightRailFull | null; tab?: string; rm?: string }) {
  // A block whose full version is the section on screen is left out of the rail (no point showing it twice).
  const showPortfolio = tab !== "portfolio";
  const showDates = tab !== "overview";
  let i = 0;
  const facts = right ? (
    <>
      {rm !== undefined && (
        <RailFact label="Relationship manager" index={i++} tone="default">
          {rm}
        </RailFact>
      )}
      <RailFact label="Open tickets" index={i++} tone="default" hint={right.tickets.total > 0 ? `${right.tickets.total} in all` : "None raised"}>
        <WsCountUp value={right.tickets.openCount} label="Open tickets" />
      </RailFact>
      <RailFact label="Marketing consent" index={i++} tone="default" hint={right.consent.salesPaused ? "Sales messages paused" : right.consent.doNotPitch ? "Do not pitch" : undefined}>
        {CONSENT_LABEL[right.consent.marketing].text}
      </RailFact>
    </>
  ) : undefined;

  return (
    <StickyRail label="Key facts and next action" facts={facts}>
      {left && showPortfolio && (
        <PhoneSheet name="rail-portfolio" title="Portfolio" summary={left.allocation.length === 0 ? "No portfolio yet" : `${left.allocation.length} asset classes`}>
        <WsRailCard title="Portfolio" labelId="c360-rail-portfolio" index={i++}>
          {left.allocation.length === 0 ? (
            <Empty title="No holdings yet" hint="Holdings appear here once the portfolio feed or an import brings them in." />
          ) : (
            <div className="grid gap-2">
              <PortfolioRing compact rows={left.allocation} aum={left.aum} asOfLabel={asOf(left.asOfIso)} />
              <Link href={`/clients/${clientId}/360?tab=portfolio`} scroll={false} className="text-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                See the portfolio
              </Link>
            </div>
          )}
        </WsRailCard>
        </PhoneSheet>
      )}
      {left?.chips && left.chips.length > 0 && showPortfolio && (
        <PhoneSheet name="rail-acceptance" title="Acceptance" summary="How open the customer is to each asset class">
          <WsRailCard title="Acceptance" labelId="c360-rail-acceptance" index={i++}>
            <AcceptanceChips chips={left.chips} />
          </WsRailCard>
        </PhoneSheet>
      )}
      {right && showDates && (
        <PhoneSheet name="rail-dates" title="Key dates" summary="Sign-up, KYC, first funding, first transaction">
          <WsRailCard title="Key dates" labelId="c360-rail-dates" index={i++}>
            <KeyDatesTrack data={right.keyDates} />
          </WsRailCard>
        </PhoneSheet>
      )}
    </StickyRail>
  );
}

// ---- section panels ----------------------------------------------------------------------------------------------

/** Overview: the hero (next best action), what was promised (one quiet line when nothing is), and the activation path. */
export function OverviewPanelView({ right, clientId, assigneeId }: { right: RightRailData; clientId: string; assigneeId: string }) {
  return (
    <>
      {right.nba ? (
        <NextBestActionHero clientId={clientId} assigneeId={assigneeId} nba={right.nba} />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="no-nba">
          <Sparkles aria-hidden className="size-4" /> {right.intelligenceAvailable ? "No action suggested right now." : "Suggestions are not available right now."}
        </p>
      )}
      {right.commitments.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="no-commitments">
          <Handshake aria-hidden className="size-4" /> No pending commitments. Nothing promised and still open.
        </p>
      ) : (
        <CommitmentsCardView commitments={right.commitments} />
      )}
      <KeyDatesCardView keyDates={right.keyDates} />
    </>
  );
}

/** Portfolio: the allocation ring with callouts, and how open the customer is to each asset class. */
export function PortfolioPanelView({ left }: { left: LeftRailData }) {
  return (
    <div className="grid items-start gap-3 xl:grid-cols-2">
      <PortfolioCardView data={left} />
      <AcceptanceCardView chips={left.chips} />
    </div>
  );
}

/** Consent: where the customer stands, with the way to change it (on the client record, where the audit trail lives). */
export function ConsentPanelView({ clientId, consent }: { clientId: string; consent: RightRailData["consent"] }) {
  return (
    <>
      <ConsentCardView consent={consent} />
      <p className="text-sm text-muted-foreground">
        To record or change consent, use the Consent tab on the{" "}
        <Link href={`/clients/${clientId}?tab=consent`} className="underline underline-offset-4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          client record
        </Link>
        .
      </p>
    </>
  );
}

/** The customer's recent calls, newest first. */
export function CallsCardView({ calls, inSheet = false }: { calls: TimelineEvent[]; /** Already inside a phone sheet: list every call, no nested "View all". */ inSheet?: boolean }) {
  return (
    <RailCard labelId="c360-calls" title="Recent calls" icon={Phone}>
      {calls.length === 0 ? (
        <Empty title="No calls yet" hint="Calls placed or received through the CRM list here." />
      ) : (
        <ShowFirst
          name="calls"
          title="Recent calls"
          noun="calls"
          limit={inSheet ? Infinity : 5}
          items={calls.map((c) => (
            <div key={c.id} className="rounded-md border border-border p-2.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{c.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{asOf(c.at)} · {formatClock(c.at)}</span>
              </div>
              {c.detail && <p className="mt-0.5 break-words text-muted-foreground">{c.detail}</p>}
              {c.actor && <p className="mt-0.5 text-xs text-muted-foreground">by {c.actor}</p>}
              {c.tone && c.tone !== "default" && <Badge variant={c.tone === "negative" ? "destructive" : c.tone === "warning" ? "warning" : "success"} className="mt-1.5">{c.tone === "negative" ? "Needs attention" : c.tone === "warning" ? "Flagged" : "Positive"}</Badge>}
            </div>
          ))}
        />
      )}
    </RailCard>
  );
}

/** Tickets and calls: helpdesk tickets (and what call/chat analysis flagged), then the calls themselves. */
export function TicketsPanelView({ clientId, tickets, issues, calls }: { clientId: string; tickets: TicketsView; issues: IntelligenceView["issues"]; calls: TimelineEvent[] }) {
  return (
    <div className="grid items-start gap-3 xl:grid-cols-2">
      <TicketsCardView clientId={clientId} tickets={tickets} openIssues={issues} />
      <PhoneSheet name="recent-calls" title="Recent calls" summary={calls.length === 0 ? "No calls yet" : `${calls.length} call${calls.length === 1 ? "" : "s"}, latest ${calls[0].detail ?? calls[0].title}`}>
        <CallsCardView calls={calls} inSheet />
      </PhoneSheet>
    </div>
  );
}
