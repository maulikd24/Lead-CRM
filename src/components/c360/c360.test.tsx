import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { buildAcceptanceChips } from "@/lib/c360/acceptance";
import { buildKeyDates } from "@/lib/c360/key-dates";
import type { TimelineEvent } from "@/lib/c360/timeline";

import { AcceptanceCardView, CommitmentsCardView, ConsentCardView, NextActionCardView, PortfolioCardView, RailError, RailSkeleton, TicketsPlaceholderCard, TimelineSkeleton } from "./rail-views";
import { TimelineView } from "./timeline-view";

const NOW = "2026-10-09T12:00:00.000Z";
const ev = (id: string, kind: TimelineEvent["kind"], at = "2026-10-09T11:50:00.000Z"): TimelineEvent => ({ id, kind, channel: kind === "call" ? "call" : "note", at, title: `Title ${id}`, detail: `Detail ${id}` });

describe("TimelineView", () => {
  it("renders day groups, titles and a live pulse for fresh events", () => {
    const html = renderToStaticMarkup(<TimelineView events={[ev("a", "call"), ev("b", "note", "2026-10-08T05:00:00.000Z")]} nowIso={NOW} />);
    expect(html).toContain("Today");
    expect(html).toContain("Yesterday");
    expect(html).toContain("Title a");
    expect(html).toContain("c360-pulse");
    expect(html).toContain('aria-pressed="true"');
  });
  it("shows the empty state", () => {
    expect(renderToStaticMarkup(<TimelineView events={[]} nowIso={NOW} />)).toContain("No activity yet");
  });
  it("hides filter chips that have no events", () => {
    const html = renderToStaticMarkup(<TimelineView events={[ev("a", "call")]} nowIso={NOW} />);
    expect(html).toContain("Conversations");
    expect(html).not.toContain("Outcomes");
  });
});

describe("rail views", () => {
  it("portfolio: empty state without holdings", () => {
    const html = renderToStaticMarkup(<PortfolioCardView data={{ aum: 0, asOfIso: null, holdingCount: 0, allocation: [], callouts: [], chips: [] }} />);
    expect(html).toContain("No holdings yet");
  });
  it("portfolio: ring, legend and callouts", () => {
    const html = renderToStaticMarkup(
      <PortfolioCardView staticRender data={{ aum: 1000000, asOfIso: "2026-10-08T00:00:00.000Z", holdingCount: 2, allocation: [{ label: "Equity", value: 600000 }, { label: "Mutual Fund", value: 400000 }], callouts: [{ key: "idle", label: "Idle cash", value: "₹1.00 L", tone: "default", hint: "" }], chips: [] }} />,
    );
    expect(html).toContain("Portfolio allocation: Equity 60.0%, Mutual Fund 40.0%");
    expect(html).toContain("var(--chart-1)");
    expect(html).toContain("Idle cash");
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
  it("acceptance: chips carry the reason for hover and focus", () => {
    const html = renderToStaticMarkup(<AcceptanceCardView chips={buildAcceptanceChips([{ assetClass: "PMS", level: "HIGH", source: "rule", reason: "Asked for minimums", isManual: false }])} />);
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("Asked for minimums");
    expect(html).toContain("aria-describedby");
  });
  it("acceptance: unavailable and empty states", () => {
    expect(renderToStaticMarkup(<AcceptanceCardView chips={null} />)).toContain("Not available right now");
    expect(renderToStaticMarkup(<AcceptanceCardView chips={[]} />)).toContain("No acceptance data yet");
  });
  it("next action: do-not-discuss and fallbacks", () => {
    const nba = { programme: "Fund account", action: "Call", topic: null, reason: "KYC done", priority: "High", owner: "RM", timing: "Today", talkingPoints: [], doNotDiscuss: ["AIF"] };
    const html = renderToStaticMarkup(<NextActionCardView nba={nba} available />);
    expect(html).toContain("Do not discuss");
    expect(html).toContain("KYC done");
    expect(renderToStaticMarkup(<NextActionCardView nba={null} available={false} />)).toContain("Not available right now");
    expect(renderToStaticMarkup(<NextActionCardView nba={null} available />)).toContain("No action suggested");
  });
  it("commitments: empty and overdue", () => {
    expect(renderToStaticMarkup(<CommitmentsCardView commitments={[]} />)).toContain("Nothing promised");
    expect(renderToStaticMarkup(<CommitmentsCardView commitments={[{ id: "1", text: "Send deck", dueAtIso: "2026-10-01T00:00:00.000Z", overdue: true }]} />)).toContain("Overdue");
  });
  it("tickets placeholder explains it is connected later", () => {
    expect(renderToStaticMarkup(<TicketsPlaceholderCard openIssues={[]} />)).toContain("connected later");
  });
  it("consent states", () => {
    const html = renderToStaticMarkup(<ConsentCardView consent={{ marketing: "not_recorded", consentAtIso: null, consentText: null, salesPaused: true, doNotPitch: true }} />);
    expect(html).toContain("Not recorded");
    expect(html).toContain("Paused");
    expect(html).toContain("Do not pitch");
  });
  it("skeletons are busy with status text; error is an alert", () => {
    expect(renderToStaticMarkup(<RailSkeleton label="portfolio" />)).toContain('aria-busy="true"');
    expect(renderToStaticMarkup(<TimelineSkeleton />)).toContain("Loading timeline");
    expect(renderToStaticMarkup(<RailError what="the timeline" />)).toContain('role="alert"');
  });
  it("key dates render step states for screen readers", async () => {
    const { KeyDatesCardView } = await import("./rail-views");
    const keyDates = buildKeyDates({ signedUpAt: new Date("2026-09-01T00:00:00Z"), kycCompletedAt: null, firstFundedAt: null, firstTransactionAt: null }, new Date("2026-10-09T00:00:00Z"));
    const html = renderToStaticMarkup(<KeyDatesCardView keyDates={keyDates} staticRender />);
    expect(html).toContain("(done)");
    expect(html).toContain("(next)");
    expect(html).toContain("waiting");
  });
});
