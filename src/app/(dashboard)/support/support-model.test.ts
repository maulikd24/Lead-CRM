import { describe, expect, it } from "vitest";

import { toTicketView, type SupportRow } from "@/lib/integrations/freshdesk/ticket-view";
import { partitionSupport, SUPPORT_TABS } from "./support-model";

const now = new Date("2026-10-07T12:00:00Z");
const mk = (id: string, over: Record<string, unknown> = {}, done = false): SupportRow => ({
  view: toTicketView({ handoff: true, ticketId: id, subject: "s" + id, ticketStatus: "open", priority: "high", intent: "KYC", sentiment: "neutral", summary: "", handoffAt: "2026-10-07T04:00:00Z", firstResponseDueAt: "2026-10-07T20:00:00Z", resolutionDueAt: "2026-10-09T04:00:00Z", ...over }, "a" + id, null)!,
  clientName: "Client " + id, rmId: "r", rmName: "RM r", taskDone: done, taskDoneAt: done ? new Date("2026-10-07T05:00:00Z") : null,
});

describe("SUPPORT_TABS", () => {
  it("lists the four sections in order", () => {
    expect(SUPPORT_TABS.map((t) => t.key)).toEqual(["queue", "breaching", "resolved", "workload"]);
  });
});

describe("partitionSupport", () => {
  it("queue holds open hand-offs nobody has picked up, most urgent first-response clock first", () => {
    const rows = [mk("1", { firstResponseDueAt: "2026-10-07T18:00:00Z" }), mk("2", { firstResponseDueAt: "2026-10-07T15:00:00Z" }), mk("3", {}, true)];
    expect(partitionSupport(rows, now).queue.map((r) => r.view.ticketId)).toEqual(["2", "1"]);
  });
  it("breaching holds open hand-offs with a breached clock, including ones already picked up", () => {
    const rows = [mk("1"), mk("2", { firstResponseDueAt: "2026-10-07T06:00:00Z" }), mk("3", { resolutionDueAt: "2026-10-07T10:00:00Z" }, true)];
    const { breaching } = partitionSupport(rows, now);
    expect(breaching.map((b) => b.row.view.ticketId).sort()).toEqual(["2", "3"]);
    expect(breaching.find((b) => b.row.view.ticketId === "2")).toMatchObject({ firstResponse: true, resolution: false });
    expect(breaching.find((b) => b.row.view.ticketId === "3")).toMatchObject({ firstResponse: false, resolution: true });
  });
  it("resolved excludes open hand-offs and shows the newest first", () => {
    const rows = [mk("1"), mk("2", { ticketStatus: "resolved", resolvedAt: "2026-10-07T06:00:00Z" }, true), mk("3", { ticketStatus: "closed", resolvedAt: "2026-10-07T09:00:00Z" }, true)];
    expect(partitionSupport(rows, now).resolved.map((r) => r.view.ticketId)).toEqual(["3", "2"]);
  });
  it("caps resolved at 25", () => {
    const rows = Array.from({ length: 40 }, (_, i) => mk(String(i), { ticketStatus: "resolved", resolvedAt: "2026-10-07T06:00:00Z" }, true));
    expect(partitionSupport(rows, now).resolved).toHaveLength(25);
  });
});
