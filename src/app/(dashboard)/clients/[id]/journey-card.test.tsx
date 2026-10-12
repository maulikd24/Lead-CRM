import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const getCustomerEventFacts = vi.fn();
vi.mock("@/lib/timeline/reader", () => ({ getCustomerEventFacts: (...args: unknown[]) => getCustomerEventFacts(...args) }));

import type { ReactElement } from "react";

import { FIRST_INVESTMENT_JOURNEY, evaluateJourney } from "@/lib/journeys/customer-journey";
import type { TimelineViewer } from "@/lib/timeline/reader";
import { JourneyCard, JourneyView } from "./journey-card";

const DAY = "2026-10-";
const started = new Date(`${DAY}01T10:00:00.000Z`);
// KYC started on day 1 and never verified; "now" is 30 days later, past the 14-day window for KYC verified.
const overdueEvaluation = evaluateJourney(
  FIRST_INVESTMENT_JOURNEY,
  [{ eventType: "account.kyc.started", occurredAt: started }],
  new Date(`${DAY}31T10:00:00.000Z`),
);
const viewerRm: TimelineViewer = { id: "rm-1", role: "RM" };
const viewerOther: TimelineViewer = { id: "rm-2", role: "RM" };

beforeEach(() => {
  getCustomerEventFacts.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("JourneyView", () => {
  it("shows done, overdue and not started rows, and names the next step with its owner", () => {
    expect(overdueEvaluation.steps.map((s) => s.status)).toEqual(["done", "overdue", "not_started"]);
    const html = renderToStaticMarkup(<JourneyView evaluation={overdueEvaluation} historyComplete />);
    expect(html).toContain("KYC started");
    expect(html).toContain(">Done<");
    expect(html).toContain(">Overdue<");
    expect(html).toContain(">Not started<");
    expect(html).toContain("Next: KYC verified, owner Ops (overdue).");
    expect(html).toContain("Nothing is sent.");
    // Read only: no button and no link that could message a customer.
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
  });

  it("warns when the event history was cut short", () => {
    const html = renderToStaticMarkup(<JourneyView evaluation={overdueEvaluation} historyComplete={false} />);
    expect(html).toContain("Earlier steps may be under-counted");
  });

  it("says the journey is complete when every step is done", () => {
    const done = evaluateJourney(
      FIRST_INVESTMENT_JOURNEY,
      [
        { eventType: "account.kyc.started", occurredAt: new Date("2026-10-01T00:00:00Z") },
        { eventType: "account.kyc.verified", occurredAt: new Date("2026-10-02T00:00:00Z") },
        { eventType: "transaction.recorded", occurredAt: new Date("2026-10-03T00:00:00Z") },
      ],
      new Date("2026-10-04T00:00:00Z"),
    );
    const html = renderToStaticMarkup(<JourneyView evaluation={done} historyComplete />);
    expect(html).toContain("All steps are done.");
    expect(html).not.toContain(">Overdue<");
  });
});

describe("JourneyCard", () => {
  it("renders nothing and reads nothing when JOURNEYS_ENABLED is off", async () => {
    vi.stubEnv("JOURNEYS_ENABLED", "0");
    const el = await JourneyCard({ clientId: "c1", viewer: viewerRm });
    expect(el).toBeNull();
    expect(getCustomerEventFacts).not.toHaveBeenCalled();
  });

  it("renders nothing when the flag is unset (default off)", async () => {
    vi.stubEnv("JOURNEYS_ENABLED", "");
    expect(await JourneyCard({ clientId: "c1", viewer: viewerRm })).toBeNull();
    expect(getCustomerEventFacts).not.toHaveBeenCalled();
  });

  it("renders nothing for an RM who does not own the lead (the reader answers not_found)", async () => {
    vi.stubEnv("JOURNEYS_ENABLED", "1");
    getCustomerEventFacts.mockResolvedValue({ ok: false, reason: "not_found" });
    const el = await JourneyCard({ clientId: "someone-elses-lead", viewer: viewerOther });
    expect(el).toBeNull();
    expect(getCustomerEventFacts).toHaveBeenCalledWith("someone-elses-lead", { viewer: viewerOther });
  });

  it("renders nothing for a role without client-360 (the reader answers forbidden)", async () => {
    vi.stubEnv("JOURNEYS_ENABLED", "1");
    getCustomerEventFacts.mockResolvedValue({ ok: false, reason: "forbidden" });
    expect(await JourneyCard({ clientId: "c1", viewer: { id: "m1", role: "MARKETING" } })).toBeNull();
  });

  it("renders the card for the RM who owns the lead, with the flag on", async () => {
    vi.stubEnv("JOURNEYS_ENABLED", "1");
    getCustomerEventFacts.mockResolvedValue({ ok: true, events: [{ eventType: "account.kyc.started", occurredAt: started }], complete: true });
    const el = await JourneyCard({ clientId: "own-lead", viewer: viewerRm });
    expect(el).not.toBeNull();
    const html = renderToStaticMarkup(el as ReactElement);
    expect(html).toContain('data-testid="journey-card"');
    expect(html).toContain("Next: KYC verified, owner Ops");
  });
});
