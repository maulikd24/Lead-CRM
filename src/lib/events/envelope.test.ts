import { describe, expect, it } from "vitest";

import { CLOCK_SKEW_MS, DEFAULT_LATE_HORIZON_MS, classifyTiming, dedupeKeyOf, eventIdFor, flowCorrelationId, uuidFrom } from "./envelope";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("deterministic ids", () => {
  it("the same input always gives the same uuid, different inputs differ", () => {
    expect(uuidFrom("a")).toBe(uuidFrom("a"));
    expect(uuidFrom("a")).not.toBe(uuidFrom("b"));
    expect(uuidFrom("a")).toMatch(UUID);
  });
  it("event ids follow (source, dedupe key); a cause can be referenced without a lookup", () => {
    const k = dedupeKeyOf("crm.web", "c1", "lead.created");
    expect(k).toBe("crm.web:c1:lead.created");
    expect(eventIdFor("crm.web", k)).toBe(eventIdFor("crm.web", k));
    expect(eventIdFor("crm.web", k)).not.toBe(eventIdFor("crm.cron", k));
  });
  it("one flow correlation id per customer, shared by every producer", () => {
    expect(flowCorrelationId("c1")).toBe(flowCorrelationId("c1"));
    expect(flowCorrelationId("c1")).not.toBe(flowCorrelationId("c2"));
  });
});

describe("classifyTiming (late events and clock skew)", () => {
  const received = new Date("2027-01-31T12:00:00Z");
  it("an on-time event is neither late nor skewed", () => expect(classifyTiming(new Date(received.getTime() - 1000), received)).toEqual({ late: false, clockSkew: false }));
  it("older than the horizon at receipt is late", () => {
    expect(classifyTiming(new Date(received.getTime() - DEFAULT_LATE_HORIZON_MS - 1), received).late).toBe(true);
    expect(classifyTiming(new Date(received.getTime() - DEFAULT_LATE_HORIZON_MS + 1000), received).late).toBe(false);
  });
  it("the horizon is configurable", () => expect(classifyTiming(new Date(received.getTime() - 2 * 3_600_000), received, 3_600_000).late).toBe(true));
  it("a source clock ahead of ours beyond the tolerance is skew, not lateness", () => {
    expect(classifyTiming(new Date(received.getTime() + CLOCK_SKEW_MS + 1), received)).toEqual({ late: false, clockSkew: true });
    expect(classifyTiming(new Date(received.getTime() + CLOCK_SKEW_MS - 1), received).clockSkew).toBe(false);
  });
});
