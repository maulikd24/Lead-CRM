import { describe, expect, it } from "vitest";

import { evaluateJourney, FIRST_INVESTMENT_JOURNEY, type JourneyDef, type JourneyEventFact } from "./customer-journey";

const DAY = 24 * 3_600_000;
const day = (n: number) => new Date(Date.UTC(2027, 0, 1) + n * DAY);
const ev = (eventType: string, n: number): JourneyEventFact => ({ eventType, occurredAt: day(n) });
const KYC_STARTED = "account.kyc.started";
const KYC_VERIFIED = "account.kyc.verified";
const INVESTED = "transaction.recorded";

describe("evaluateJourney: step status", () => {
  it("marks completed steps done with their completion time", () => {
    const r = evaluateJourney(FIRST_INVESTMENT_JOURNEY, [ev(KYC_STARTED, 0), ev(KYC_VERIFIED, 3)], day(4));
    expect(r.steps.map((s) => s.status)).toEqual(["done", "done", "not_started"]);
    expect(r.steps[1].completedAt).toBe(day(3).toISOString());
  });

  it("marks the open step overdue when its window after the previous step has passed", () => {
    // Verified on day 3; the first investment is due 30 days later (day 33). At day 40 it is overdue.
    const r = evaluateJourney(FIRST_INVESTMENT_JOURNEY, [ev(KYC_STARTED, 0), ev(KYC_VERIFIED, 3)], day(40));
    expect(r.steps[2]).toMatchObject({ status: "overdue", dueAt: day(33).toISOString() });
    expect(r.next).toMatchObject({ stepId: "first-investment", status: "overdue" });
  });

  it("keeps the open step not started while still inside its window", () => {
    const r = evaluateJourney(FIRST_INVESTMENT_JOURNEY, [ev(KYC_STARTED, 0), ev(KYC_VERIFIED, 3)], day(20));
    expect(r.steps[2].status).toBe("not_started");
  });

  it("never marks the first step overdue, because it has no previous completion", () => {
    const r = evaluateJourney(FIRST_INVESTMENT_JOURNEY, [], day(10_000));
    expect(r.steps[0]).toMatchObject({ status: "not_started", dueAt: null });
  });

  it("is complete when every step is done", () => {
    const r = evaluateJourney(FIRST_INVESTMENT_JOURNEY, [ev(KYC_STARTED, 0), ev(KYC_VERIFIED, 1), ev(INVESTED, 2)], day(3));
    expect(r.steps.every((s) => s.status === "done")).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.next).toBeNull();
  });
});

describe("evaluateJourney: next step", () => {
  it("is the first incomplete step in order, with its owner role", () => {
    const r = evaluateJourney(FIRST_INVESTMENT_JOURNEY, [ev(KYC_STARTED, 0)], day(1));
    expect(r.next).toEqual({ stepId: "kyc-verified", label: "KYC verified", ownerRole: "ops", status: "not_started" });
    expect(r.complete).toBe(false);
  });

  it("returns the first step for an empty stream", () => {
    const r = evaluateJourney(FIRST_INVESTMENT_JOURNEY, [], day(1));
    expect(r.next).toMatchObject({ stepId: "kyc-started", ownerRole: "rm", status: "not_started" });
    expect(r.steps.every((s) => s.status === "not_started")).toBe(true);
  });

  it("is deterministic for the same input, and does not depend on input order", () => {
    const events = [ev(KYC_VERIFIED, 3), ev(KYC_STARTED, 0)];
    const a = evaluateJourney(FIRST_INVESTMENT_JOURNEY, events, day(4));
    const b = evaluateJourney(FIRST_INVESTMENT_JOURNEY, [...events].reverse(), day(4));
    expect(a).toEqual(b);
  });
});

describe("evaluateJourney: out-of-order events", () => {
  it("does not skip a step when a later step's event exists alone", () => {
    const r = evaluateJourney(FIRST_INVESTMENT_JOURNEY, [ev(INVESTED, 5)], day(6));
    expect(r.steps.map((s) => s.status)).toEqual(["not_started", "not_started", "not_started"]);
    expect(r.next?.stepId).toBe("kyc-started");
  });

  it("does not count an event that happened before the previous step completed", () => {
    // Verified on day 1 but started only on day 2: verification is not after the start, so it does not complete step 2.
    const r = evaluateJourney(FIRST_INVESTMENT_JOURNEY, [ev(KYC_VERIFIED, 1), ev(KYC_STARTED, 2)], day(3));
    expect(r.steps.map((s) => s.status)).toEqual(["done", "not_started", "not_started"]);
    expect(r.next?.stepId).toBe("kyc-verified");
  });

  it("ignores events of other types and invalid dates", () => {
    const r = evaluateJourney(FIRST_INVESTMENT_JOURNEY, [{ eventType: "whatsapp.message.sent", occurredAt: day(0) }, { eventType: KYC_STARTED, occurredAt: new Date("nope") }], day(1));
    expect(r.steps[0].status).toBe("not_started");
  });
});

describe("evaluateJourney: a custom definition", () => {
  it("uses each step's own window", () => {
    const def: JourneyDef = { id: "t", name: "t", steps: [{ id: "a", label: "A", eventType: "x.a", ownerRole: "rm" }, { id: "b", label: "B", eventType: "x.b", ownerRole: "compliance", maxDaysAfterPrevious: 2 }] };
    expect(evaluateJourney(def, [ev("x.a", 0)], day(3)).steps[1].status).toBe("overdue");
    expect(evaluateJourney(def, [ev("x.a", 0)], day(2)).steps[1].status).toBe("not_started");
  });
});
