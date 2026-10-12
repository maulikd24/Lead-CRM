import { describe, expect, it } from "vitest";
import { computeSupportStats, isOpenStatus, resolveTicketLink, toTicketView, type SupportRow } from "./ticket-view";

const NOW = new Date("2026-10-07T12:00:00Z");
const payload = (over: Record<string, unknown> = {}) => ({
  handoff: true, ticketId: "1", subject: "s", ticketStatus: "open", priority: "high", intent: "KYC", sentiment: "neutral", summary: "sum",
  handoffAt: "2026-10-07T04:00:00Z", firstResponseDueAt: "2026-10-07T08:00:00Z", resolutionDueAt: "2026-10-08T04:00:00Z", ...over,
});

describe("resolveTicketLink", () => {
  it("prefers the ticket's own https link", () => expect(resolveTicketLink("https://x.freshdesk.com/a/tickets/1", "https://other.example", "1")).toBe("https://x.freshdesk.com/a/tickets/1"));
  it("builds from the configured base URL", () => {
    expect(resolveTicketLink(undefined, "https://acme.freshdesk.com/", "42")).toBe("https://acme.freshdesk.com/a/tickets/42");
  });
  it("refuses non-https and unconfigured", () => {
    expect(resolveTicketLink(undefined, "http://acme.freshdesk.com", "42")).toBeNull();
    expect(resolveTicketLink("javascript:alert(1)", null, "42")).toBeNull();
    expect(resolveTicketLink(undefined, null, "42")).toBeNull();
  });
});

describe("toTicketView", () => {
  it("parses a stored payload", () => expect(toTicketView(payload(), "a1", null)).toMatchObject({ activityId: "a1", ticketId: "1", status: "open", priority: "high", link: null }));
  it("returns null for non hand-off or broken payloads", () => {
    expect(toTicketView({ ticketId: "1" }, "a", null)).toBeNull();
    expect(toTicketView(null, "a", null)).toBeNull();
    expect(toTicketView(payload({ handoffAt: "nonsense" }), "a", null)).toBeNull();
  });
  it("isOpenStatus", () => {
    expect(isOpenStatus("open")).toBe(true);
    expect(isOpenStatus("Resolved")).toBe(false);
    expect(isOpenStatus("closed")).toBe(false);
  });
});

const row = (id: string, over: Record<string, unknown>, extra: Partial<SupportRow> = {}): SupportRow => ({
  view: toTicketView(payload({ ticketId: id, ...over }), `a${id}`, null)!,
  clientName: "C" + id, rmId: "rm1", rmName: "Asha", taskDone: false, taskDoneAt: null, ...extra,
});

describe("computeSupportStats", () => {
  it("returns an honest empty result", () => {
    expect(computeSupportStats([], NOW)).toMatchObject({ total: 0, open: 0, compliancePct: null, waitingForRm: 0, perRm: [] });
  });
  it("counts open by status and priority and RM load", () => {
    const s = computeSupportStats([row("1", {}), row("2", { priority: "urgent", ticketStatus: "pending" }), row("3", { ticketStatus: "resolved", resolvedAt: "2026-10-07T06:00:00Z" })], NOW);
    expect(s.open).toBe(2);
    expect(s.byPriority).toMatchObject({ high: 1, urgent: 1 });
    expect(s.byStatus).toMatchObject({ open: 1, pending: 1 });
    expect(s.perRm).toEqual([expect.objectContaining({ rmId: "rm1", open: 2 })]);
  });
  it("waiting for RM = open and not yet followed up", () => {
    const s = computeSupportStats([row("1", {}), row("2", {}, { taskDone: true, taskDoneAt: new Date("2026-10-07T05:00:00Z") })], NOW);
    expect(s.waitingForRm).toBe(1);
  });
  it("first-response breach: overdue unanswered, or answered late", () => {
    const s = computeSupportStats([row("1", {}), row("2", {}, { taskDone: true, taskDoneAt: new Date("2026-10-07T09:00:00Z") }), row("3", {}, { taskDone: true, taskDoneAt: new Date("2026-10-07T06:00:00Z") })], NOW);
    expect(s.firstResponseBreaches).toBe(2);
  });
  it("resolution breach: open past due, or resolved late", () => {
    const s = computeSupportStats([row("1", { resolutionDueAt: "2026-10-07T10:00:00Z" }), row("2", { ticketStatus: "resolved", resolvedAt: "2026-10-09T00:00:00Z" }), row("3", { ticketStatus: "resolved", resolvedAt: "2026-10-07T06:00:00Z" })], NOW);
    expect(s.resolutionBreaches).toBe(2);
  });
  it("compliance % is hand-offs with no breach, rounded", () => {
    const s = computeSupportStats([row("1", {}), row("2", {}, { taskDone: true, taskDoneAt: new Date("2026-10-07T05:00:00Z") }), row("3", {}, { taskDone: true, taskDoneAt: new Date("2026-10-07T05:00:00Z") })], NOW);
    expect(s.compliancePct).toBe(67);
  });
});
