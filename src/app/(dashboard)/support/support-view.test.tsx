import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const nav = vi.hoisted(() => ({ tab: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.tab ? `tab=${nav.tab}` : ""),
  usePathname: () => "/support",
}));

import { SupportView } from "./support-view";
import { toTicketView, type SupportRow } from "@/lib/integrations/freshdesk/ticket-view";

const now = new Date("2026-10-07T12:00:00Z");
const mk = (id: string, rm: string, over: Record<string, unknown> = {}, done = false): SupportRow => ({
  view: toTicketView({ handoff: true, ticketId: id, subject: "s" + id, ticketStatus: "open", priority: "high", intent: "KYC", sentiment: "neutral", summary: "", handoffAt: "2026-10-07T04:00:00Z", firstResponseDueAt: "2026-10-07T08:00:00Z", resolutionDueAt: "2026-10-09T04:00:00Z", ...over }, "a" + id, null)!,
  clientName: "Client " + id, rmId: rm, rmName: "RM " + rm, taskDone: done, taskDoneAt: done ? new Date("2026-10-07T05:00:00Z") : null,
});
const render = (rows: SupportRow[], tab = "") => {
  nav.tab = tab;
  return renderToStaticMarkup(<SupportView rows={rows} now={now} />);
};

describe("SupportView", () => {
  it("shows the honest empty state", () => {
    const out = render([]);
    expect(out).toContain("Connect Freshdesk and enable hand-offs");
    expect(out).not.toContain("progressbar");
    expect(out).not.toContain("tablist");
  });

  it("is a tabbed workspace: four tabs, one panel, the queue first", () => {
    const out = render([mk("1", "a")]);
    expect(out).toContain('role="tablist"');
    for (const label of ["Queue", "Breaching", "Resolved", "Workload"]) expect(out).toContain(label);
    expect(out.match(/role="tabpanel"/g)).toHaveLength(1);
    expect(out).toMatch(/id="support-tab-queue"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="support-tab-queue"/);
  });

  it("puts the SLA figures in the rail: ring and the four counts", () => {
    const out = render([mk("1", "a"), mk("2", "a", {}, true), mk("3", "b", { priority: "urgent" })]);
    expect(out).toContain("SLA compliance: 33 percent");
    for (const label of ["Open hand-offs", "Waiting for an RM", "First-response breaches", "Resolution breaches"]) expect(out).toContain(label);
  });

  it("queue lists only hand-offs nobody has picked up", () => {
    const out = render([mk("1", "a"), mk("2", "a", {}, true), mk("3", "b", { priority: "urgent" })]);
    expect(out).toContain("Client 1");
    expect(out).toContain("Client 3");
    expect(out).not.toContain("Client 2"); // already picked up
  });

  it("breaching lists open hand-offs with a breached clock, with the clock in words", () => {
    const out = render([mk("1", "a"), mk("2", "a", { firstResponseDueAt: "2026-10-07T20:00:00Z" })], "breaching");
    expect(out).toContain("Client 1");
    expect(out).not.toContain("Client 2");
    expect(out).toContain("Breached");
  });

  it("resolved shows resolved hand-offs only, and the queue does not", () => {
    const rows = [mk("1", "a"), mk("7", "a", { ticketStatus: "resolved", resolvedAt: "2026-10-07T06:00:00Z" }, true)];
    expect(render(rows, "resolved")).toContain("Client 7");
    expect(render(rows, "resolved")).not.toContain("Client 1 ");
    expect(render(rows)).not.toContain("Client 7");
  });

  it("workload shows priority, status and per-RM load", () => {
    const out = render([mk("1", "a"), mk("3", "b", { priority: "urgent" })], "workload");
    expect(out).toContain("Open by priority and status");
    expect(out).toContain("Load per RM");
    expect(out).toContain("RM a");
    expect(out).toContain("RM b");
  });

  it("an unknown ?tab= falls back to the queue", () => {
    expect(render([mk("1", "a")], "nope")).toContain("Client 1");
  });
});
