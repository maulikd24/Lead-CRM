import Link from "next/link";
import { Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { CountUp as WsCountUp, RailCard as WsRailCard, RailFact, StickyRail } from "@/components/workspace";
import type { IntelligenceView } from "@/lib/intelligence/view";
import type { TicketsView } from "@/lib/c360/tickets";
import { formatClock, type TimelineEvent } from "@/lib/c360/timeline";

import { KeyDatesTrack } from "./key-dates-track";
import { PortfolioRing } from "./portfolio-ring";
import {
  AcceptanceCardView,
  AcceptanceChips,
  asOf,
  CommitmentsCardView,
  ConsentCardView,
  Empty,
  KeyDatesCardView,
  NextActionCardView,
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
  withdrawn: { text: "Withdrawn", tone: "warning" },
  expired: { text: "Expired", tone: "warning" },
  do_not_contact: { text: "Do not contact", tone: "destructive" },
  not_recorded: { text: "Not recorded", tone: "default" },
};

/** Header chip: where the customer stands on marketing consent. */
export function ConsentChipView({ marketing }: { marketing: RightRailData["consent"]["marketing"] }) {
  const { text, tone } = CONSENT_LABEL[marketing];
  const variant = tone === "success" ? "success" : tone === "warning" ? "warning" : tone === "destructive" ? "destructive" : "outline";
  return <Badge variant={variant}>Consent: {text}</Badge>;
}

const PRIORITY_TONE: Record<string, "destructive" | "warning" | "default"> = { High: "destructive", Medium: "warning", Low: "default" };

/**
 * The rail: key facts and the next action, always in view. Next step, open tickets and consent are the facts (a swipeable
 * strip on a phone); the portfolio ring, acceptance chips and key dates are the blocks (minus whichever the section on screen
 * already shows in full). Either half may be missing (a half
 * that failed to load is simply left out; the section panel shows the error).
 */
export function RailSummary({ clientId, left, right, tab }: { clientId: string; left: LeftRailData | null; right: RightRailFull | null; tab?: string }) {
  // A block whose full version is the section on screen is left out of the rail (no point showing it twice).
  const showPortfolio = tab !== "portfolio";
  const showDates = tab !== "overview";
  let i = 0;
  const facts = right ? (
    <>
      <RailFact label="Next step" index={i++} hint={right.nba ? `${right.nba.programme}${right.nba.topic ? ` · ${right.nba.topic}` : ""}` : undefined} tone={right.nba ? PRIORITY_TONE[right.nba.priority] ?? "default" : "default"}>
        {right.nba ? (
          <>
            {right.nba.action}
            <span className="block text-xs font-normal text-muted-foreground">{right.nba.timing} · owner {right.nba.owner}</span>
          </>
        ) : (
          <span className="text-sm font-medium text-muted-foreground">{right.intelligenceAvailable ? "No action suggested" : "Not available right now"}</span>
        )}
      </RailFact>
      <RailFact label="Open tickets" index={i++} tone={right.tickets.openCount > 0 ? "warning" : "default"} hint={right.tickets.total > 0 ? `${right.tickets.total} in all` : "None raised"}>
        <WsCountUp value={right.tickets.openCount} label="Open tickets" />
      </RailFact>
      <RailFact label="Marketing consent" index={i++} tone={CONSENT_LABEL[right.consent.marketing].tone} hint={right.consent.salesPaused ? "Sales messages paused" : right.consent.doNotPitch ? "Do not pitch" : undefined}>
        {CONSENT_LABEL[right.consent.marketing].text}
      </RailFact>
    </>
  ) : undefined;

  return (
    <StickyRail label="Key facts and next action" facts={facts}>
      {left && showPortfolio && (
        <WsRailCard title="Portfolio" labelId="c360-rail-portfolio" index={i++}>
          {left.allocation.length === 0 ? (
            <Empty title="No holdings yet" hint="Holdings appear here once the portfolio feed or an import brings them in." />
          ) : (
            <div className="grid gap-2">
              <PortfolioRing compact rows={left.allocation} aum={left.aum} asOfLabel={asOf(left.asOfIso)} />
              <Link href={`/clients/${clientId}/360?tab=portfolio`} scroll={false} className="text-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                {left.holdingCount} holding{left.holdingCount === 1 ? "" : "s"}, see the portfolio
              </Link>
            </div>
          )}
        </WsRailCard>
      )}
      {left?.chips && left.chips.length > 0 && showPortfolio && (
        <WsRailCard title="Acceptance" labelId="c360-rail-acceptance" index={i++}>
          <AcceptanceChips chips={left.chips} />
        </WsRailCard>
      )}
      {right && showDates && (
        <WsRailCard title="Key dates" labelId="c360-rail-dates" index={i++}>
          <KeyDatesTrack data={right.keyDates} />
        </WsRailCard>
      )}
    </StickyRail>
  );
}

// ---- section panels ----------------------------------------------------------------------------------------------

/** Overview: the next action in full (with do-not-discuss), what was promised, and the activation path. */
export function OverviewPanelView({ right }: { right: RightRailData }) {
  return (
    <>
      <NextActionCardView nba={right.nba} available={right.intelligenceAvailable} />
      <div className="grid gap-3 xl:grid-cols-2">
        <CommitmentsCardView commitments={right.commitments} />
        <KeyDatesCardView keyDates={right.keyDates} />
      </div>
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
export function CallsCardView({ calls }: { calls: TimelineEvent[] }) {
  return (
    <RailCard labelId="c360-calls" title="Recent calls" icon={Phone}>
      {calls.length === 0 ? (
        <Empty title="No calls yet" hint="Calls placed or received through the CRM list here." />
      ) : (
        <ul className="grid gap-2">
          {calls.map((c) => (
            <li key={c.id} className="rounded-md border border-border p-2.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{c.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{asOf(c.at)} · {formatClock(c.at)}</span>
              </div>
              {c.detail && <p className="mt-0.5 break-words text-muted-foreground">{c.detail}</p>}
              {c.actor && <p className="mt-0.5 text-xs text-muted-foreground">by {c.actor}</p>}
              {c.tone && c.tone !== "default" && <Badge variant={c.tone === "negative" ? "destructive" : c.tone === "warning" ? "warning" : "success"} className="mt-1.5">{c.tone === "negative" ? "Needs attention" : c.tone === "warning" ? "Flagged" : "Positive"}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

/** Tickets and calls: helpdesk tickets (and what call/chat analysis flagged), then the calls themselves. */
export function TicketsPanelView({ clientId, tickets, issues, calls }: { clientId: string; tickets: TicketsView; issues: IntelligenceView["issues"]; calls: TimelineEvent[] }) {
  return (
    <div className="grid items-start gap-3 xl:grid-cols-2">
      <TicketsCardView clientId={clientId} tickets={tickets} openIssues={issues} />
      <CallsCardView calls={calls} />
    </div>
  );
}
