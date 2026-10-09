import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SupportView } from "./support-view";
import { toTicketView, type SupportRow } from "@/lib/integrations/freshdesk/ticket-view";

const now = new Date("2026-10-07T12:00:00Z");
const mk = (id: string, rm: string, over: Record<string, unknown> = {}, done = false): SupportRow => ({
  view: toTicketView({ handoff: true, ticketId: id, subject: "s" + id, ticketStatus: "open", priority: "high", intent: "KYC", sentiment: "neutral", summary: "", handoffAt: "2026-10-07T04:00:00Z", firstResponseDueAt: "2026-10-07T08:00:00Z", resolutionDueAt: "2026-10-09T04:00:00Z", ...over }, "a" + id, null)!,
  clientName: "Client " + id, rmId: rm, rmName: "RM " + rm, taskDone: done, taskDoneAt: done ? new Date("2026-10-07T05:00:00Z") : null,
});

describe("SupportView", () => {
  it("shows the honest empty state", () => {
    const out = renderToStaticMarkup(<SupportView rows={[]} now={now} />);
    expect(out).toContain("Connect Freshdesk and enable hand-offs");
    expect(out).not.toContain("progressbar");
  });
  it("renders ring, counts, per-RM load and the waiting list", () => {
    const out = renderToStaticMarkup(<SupportView rows={[mk("1", "a"), mk("2", "a", {}, true), mk("3", "b", { priority: "urgent" })]} now={now} />);
    expect(out).toContain("SLA compliance: 33 percent");
    expect(out).toContain("Waiting for an RM");
    expect(out).toContain("RM a");
    expect(out).toContain("RM b");
    expect(out).toContain("Client 1");
    expect(out).not.toContain("Client 2"); // already picked up
  });
});
