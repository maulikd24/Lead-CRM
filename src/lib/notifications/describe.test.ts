import { describe, expect, it } from "vitest";

import { describeNotification, notificationCategory, notificationUrl } from "./describe";

const n = { type: "duplicate_review_requested", payload: { suggestionId: "s1", clientId: "c1", clientCode: "C-001", rmName: "Asha", requestedById: "u1" } };

describe("duplicate_review_requested notification", () => {
  it("names the RM and the RM's own customer code, and nothing about the other customer", () => {
    expect(describeNotification(n)).toBe("Asha asks you to review a possible duplicate of C-001");
  });
  it("lands on the duplicate review queue, not on the (possibly out-of-team) customer page", () => {
    expect(notificationUrl(n)).toBe("/clients/duplicates");
  });
  it("belongs to the assignments category", () => {
    expect(notificationCategory(n.type)).toBe("assignments");
  });
});

describe("lead push notifications", () => {
  const push = { type: "lead_push", payload: { clientId: "c1", clientName: "Meera Iyer", campaign: "Retirement Planning - Lead Form", creative: "Retire at 55 carousel", slaMinutes: 15 } };
  it("a new lead names the customer, the campaign and the time to call", () => {
    expect(describeNotification(push)).toBe("New lead Meera Iyer from Retirement Planning - Lead Form: call within 15 min");
    expect(describeNotification({ type: "lead_push", payload: { clientId: "c1", clientName: "Meera Iyer", campaign: null, slaMinutes: 15 } })).toBe("New lead Meera Iyer: call within 15 min");
    expect(describeNotification({ type: "lead_push", payload: { clientId: "c1", clientName: "Meera Iyer", campaign: null, slaMinutes: 15, unassigned: true } })).toBe("New lead Meera Iyer has no RM yet: assign it and call within 15 min");
  });
  it("a breach tells the manager how late and what to do", () => {
    expect(describeNotification({ type: "lead_sla_breach", payload: { clientId: "c1", clientName: "Meera Iyer", campaign: "Retirement Planning", minutesPastSla: 42, slaMinutes: 15 } })).toBe("Meera Iyer was not contacted within 15 min (42 min past): follow up with the RM");
  });
  it("both go to the customer's page and are grouped with new leads and SLAs", () => {
    expect(notificationUrl(push)).toBe("/clients/c1");
    expect(notificationCategory("lead_push")).toBe("assignments");
    expect(notificationCategory("lead_sla_breach")).toBe("sla_tasks");
  });
});
