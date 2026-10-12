import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildAcceptanceChips } from "@/lib/c360/acceptance";
import { buildKeyDates } from "@/lib/c360/key-dates";
import type { TimelineEvent } from "@/lib/c360/timeline";

import { CallsCardView, ConsentPanelView, OverviewPanelView, PortfolioPanelView, RailSummary, TicketsPanelView, type RightRailFull } from "./workspace-views";
import type { LeftRailData } from "./rail-views";

const keyDates = buildKeyDates({ signedUpAt: new Date("2026-09-01T00:00:00Z"), kycCompletedAt: new Date("2026-09-03T00:00:00Z"), firstFundedAt: null, firstTransactionAt: null }, new Date("2026-10-09T00:00:00Z"));
const nba = { programme: "Wealth", action: "Review", topic: "Portfolio rebalance", reason: "PMS is 49% of the portfolio", priority: "High", owner: "RM", timing: "This week", talkingPoints: [], doNotDiscuss: ["AIF"] };
const consent = { marketing: "given" as const, consentAtIso: "2026-09-20T00:00:00.000Z", sourceLabel: "App", channelLabel: "WhatsApp", consentText: null, salesPaused: false, doNotPitch: false };
const tickets = { total: 3, openCount: 2, hiddenCount: 0, shown: [{ id: "t1", externalId: "9001", subject: "Cannot see my SIP", status: "open", statusLabel: "Open", priority: "urgent", open: true, createdIso: "2026-10-09T00:00:00.000Z" }] };
const right: RightRailFull = { nba, commitments: [{ id: "c", text: "Send the fact sheet", dueAtIso: null, overdue: false }], issues: [], keyDates, consent, intelligenceAvailable: true, tickets } as unknown as RightRailFull;
const rightWithTickets = right;
const left: LeftRailData = { aum: 2337000, asOfIso: "2026-10-09T00:00:00.000Z", holdingCount: 5, allocation: [{ label: "Equity", value: 1000000 }, { label: "Mutual Fund", value: 1337000 }], callouts: [], chips: buildAcceptanceChips([{ assetClass: "PMS", level: "HIGH", source: "rule", reason: "Asked for minimums", isManual: false }]) };

describe("RailSummary (the rail of key facts and the next action)", () => {
  const html = renderToStaticMarkup(<RailSummary clientId="c1" left={left} right={rightWithTickets} tab="timeline" />);
  it("leads with the next step", () => {
    expect(html).toContain("Next step");
    expect(html).toContain("Review");
    expect(html).toContain("This week");
  });
  it("shows the open tickets, consent and key dates at a glance", () => {
    expect(html).toContain("Open tickets");
    expect(html).toContain(">2<");
    expect(html).toContain("Marketing consent");
    expect(html).toContain("Given");
    expect(html).toContain("Key dates");
  });
  it("shows the portfolio ring and the acceptance chips", () => {
    expect(html).toContain("Portfolio allocation: Equity");
    expect(html).toContain("Acceptance");
    expect(html).toContain("Asked for minimums");
  });
  it("leaves out a block whose full version is the section on screen", () => {
    const onPortfolio = renderToStaticMarkup(<RailSummary clientId="c1" left={left} right={rightWithTickets} tab="portfolio" />);
    expect(onPortfolio).not.toContain("Portfolio allocation");
    expect(onPortfolio).not.toContain("Asked for minimums");
    expect(onPortfolio).toContain("Key dates");
    const onOverview = renderToStaticMarkup(<RailSummary clientId="c1" left={left} right={rightWithTickets} tab="overview" />);
    expect(onOverview).not.toContain("Key dates");
    expect(onOverview).toContain("Portfolio allocation");
  });
  it("is the labelled rail landmark", () => expect(html).toContain('aria-label="Key facts and next action"'));
  it("degrades when a half is missing: no right data, no left data", () => {
    const noRight = renderToStaticMarkup(<RailSummary clientId="c1" left={left} right={null} />);
    expect(noRight).toContain("Portfolio allocation");
    expect(noRight).not.toContain("Open tickets");
    const noLeft = renderToStaticMarkup(<RailSummary clientId="c1" left={null} right={rightWithTickets} />);
    expect(noLeft).toContain("Open tickets");
    expect(noLeft).not.toContain("Portfolio allocation");
  });
  it("says so when there are no holdings or no next step", () => {
    const out = renderToStaticMarkup(<RailSummary clientId="c1" left={{ ...left, allocation: [], holdingCount: 0, aum: 0 }} right={{ ...rightWithTickets, nba: null } as RightRailFull} />);
    expect(out).toContain("No holdings yet");
    expect(out).toContain("No action suggested");
  });
});

describe("section panels", () => {
  it("overview: next action in full, commitments and key dates", () => {
    const out = renderToStaticMarkup(<OverviewPanelView right={right} />);
    expect(out).toContain("Next best action");
    expect(out).toContain("Do not discuss");
    expect(out).toContain("Send the fact sheet");
    expect(out).toContain("Key dates");
  });
  it("portfolio: the allocation and the acceptance", () => {
    const out = renderToStaticMarkup(<PortfolioPanelView left={left} />);
    expect(out).toContain("Portfolio allocation");
    expect(out).toContain("Acceptance");
  });
  it("consent: status and a way to change it on the client record", () => {
    const out = renderToStaticMarkup(<ConsentPanelView clientId="c1" consent={consent} />);
    expect(out).toContain("Marketing consent");
    expect(out).toContain('href="/clients/c1?tab=consent"');
  });
  it("tickets and calls: tickets, flagged issues and recent calls", () => {
    const call = { id: "k1", at: "2026-10-09T10:00:00.000Z", kind: "call", channel: "call", title: "Call", detail: "1m 30s", actor: "RM Raj", tone: "default" } as unknown as TimelineEvent;
    const out = renderToStaticMarkup(<TicketsPanelView clientId="c1" tickets={tickets} issues={[]} calls={[call]} />);
    expect(out).toContain("Cannot see my SIP");
    expect(out).toContain("Recent calls");
    expect(out).toContain("RM Raj");
  });
  it("calls: clear empty state", () => {
    expect(renderToStaticMarkup(<CallsCardView calls={[]} />)).toContain("No calls yet");
  });
});
