import { describe, expect, it } from "vitest";

import { buildTicketFacts, classifyIssue, summaryLines, HISTORY_WINDOW_DAYS } from "./facts";
import { NOW, view } from "./test-fixtures";

const base = { now: NOW, respondedAt: null, openComplaints: 0, openCommitments: 0, escalatedAtHandoff: false, channel: "Email" };
const DAY = 86_400_000;

describe("the summary is built from facts", () => {
  it("every line is a fixed sentence filled from a fact", () => {
    const f = buildTicketFacts({
      ...base,
      view: view(),
      history: [
        { kind: "ticket", at: new Date(NOW.getTime() - 10 * DAY) },
        { kind: "complaint", at: new Date(NOW.getTime() - 20 * DAY) },
        { kind: "call", at: new Date(NOW.getTime() - 3 * DAY) },
      ],
    });
    const lines = summaryLines(f);
    expect(lines[0]).toBe("Ticket 4521 is open, medium priority, handed off 2026-10-14.");
    expect(lines).toContain("Likely issue: Statement or document request (Statement request).");
    expect(lines).toContain("Last 90 days: 1 support ticket, 1 complaint, 1 contact.");
    expect(lines).toContain("Last contact: call on 2026-10-11.");
  });

  it("history is reduced to kinds and dates: no names, no contact details, no free text in the summary", () => {
    const f = buildTicketFacts({ ...base, view: view(), history: [{ kind: "message", at: new Date(NOW.getTime() - DAY) }] });
    const text = summaryLines(f).join(" ");
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\d{6,}/);
    expect(text).not.toMatch(/\+91|ABCDE1234F/);
  });

  it("counts only the last 90 days of history", () => {
    const f = buildTicketFacts({
      ...base,
      view: view(),
      history: [
        { kind: "ticket", at: new Date(NOW.getTime() - (HISTORY_WINDOW_DAYS + 5) * DAY) },
        { kind: "ticket", at: new Date(NOW.getTime() - 2 * DAY) },
      ],
    });
    expect(f.history.supportTickets).toBe(1);
  });

  it("states that nothing is on record when there was no contact", () => {
    const f = buildTicketFacts({ ...base, view: view(), history: [] });
    expect(summaryLines(f)).toContain("No contact on record.");
  });

  it("adds the open complaint and commitment lines only when there are some", () => {
    const quiet = summaryLines(buildTicketFacts({ ...base, view: view(), history: [] }));
    expect(quiet.some((l) => l.includes("open complaint"))).toBe(false);
    const loud = summaryLines(buildTicketFacts({ ...base, view: view(), history: [], openComplaints: 2, openCommitments: 1 }));
    expect(loud).toContain("2 open complaint, incorrect-information or compliance concerns on record.");
    expect(loud).toContain("1 open commitment owed to the customer.");
  });
});

describe("issue category and escalation", () => {
  it.each([
    ["I want to complain, this is unacceptable", "complaint"],
    ["KYC mismatch on my nominee details", "compliance"],
    ["Brokerage charged twice", "billing"],
    ["Cannot log in to the app", "account_access"],
    ["Order not received yet", "transaction_status"],
    ["Please send my statement", "documents"],
    ["Hello, a question", "general"],
  ])("classifies %j as %s", (text, category) => {
    expect(classifyIssue(text)).toBe(category);
  });

  it("a complaint-like ticket is escalated, with the reason on record", () => {
    const f = buildTicketFacts({ ...base, view: view({ subject: "I want to complain", intent: "Complaint" }), history: [] });
    expect(f.escalate).toBe(true);
    expect(f.escalateReasons).toContain("the ticket reads as a complaint");
    expect(summaryLines(f).some((l) => l.startsWith("Escalation suggested:"))).toBe(true);
  });

  it("an unhappy customer escalates even with a plain subject", () => {
    const f = buildTicketFacts({ ...base, view: view({ sentiment: "negative" }), history: [] });
    expect(f.escalate).toBe(true);
    expect(f.escalateReasons).toContain("the customer sounded unhappy");
  });

  it("an open complaint on the record escalates a routine ticket", () => {
    const f = buildTicketFacts({ ...base, view: view(), history: [], openComplaints: 1 });
    expect(f.escalate).toBe(true);
  });

  it("a routine statement request does not escalate", () => {
    const f = buildTicketFacts({ ...base, view: view(), history: [] });
    expect(f.escalate).toBe(false);
  });
});
