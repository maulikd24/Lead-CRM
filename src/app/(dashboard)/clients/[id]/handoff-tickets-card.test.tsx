import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { HandoffTicketsCard } from "./handoff-tickets-card";
import type { HandoffTicketView } from "@/lib/integrations/freshdesk/ticket-view";

const now = new Date("2026-10-07T12:00:00Z");
const ticket = (over: Partial<HandoffTicketView> = {}): HandoffTicketView => ({
  activityId: "a1", ticketId: "77", subject: "KYC status", status: "open", priority: "high", intent: "KYC status", sentiment: "negative",
  summary: "Wants a call.", handoffAt: new Date("2026-10-07T08:00:00Z"), firstResponseDueAt: new Date("2026-10-07T11:00:00Z"),
  resolutionDueAt: new Date("2026-10-08T08:00:00Z"), resolvedAt: null, link: "https://acme.freshdesk.com/a/tickets/77", ...over,
});

describe("HandoffTicketsCard", () => {
  it("renders nothing without hand-offs", () => expect(renderToStaticMarkup(<HandoffTicketsCard tickets={[]} now={now} />)).toBe(""));
  it("shows chips, SLA bars and a safe external link", () => {
    const out = renderToStaticMarkup(<HandoffTicketsCard tickets={[ticket()]} now={now} />);
    expect(out).toContain("KYC status");
    expect(out).toContain("Breached"); // first response due 11:00, now 12:00
    expect(out).toContain("unhappy customer");
    expect(out).toContain('href="https://acme.freshdesk.com/a/tickets/77"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
  it("omits the link when none is available", () => expect(renderToStaticMarkup(<HandoffTicketsCard tickets={[ticket({ link: null })]} now={now} />)).not.toContain("Open in Freshdesk"));
});
