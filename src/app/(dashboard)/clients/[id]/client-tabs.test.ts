import { describe, expect, it } from "vitest";

import { buildClientTabs, CLIENT_TAB_FALLBACK } from "./client-tabs";

describe("client record tabs", () => {
  it("keeps every existing section, Overview first", () => {
    const keys = buildClientTabs({ consent: false, openTickets: 0 }).map((t) => t.key);
    expect(keys).toEqual(["overview", "onboarding", "activity", "tasks", "funding", "opportunities", "wealth", "support", "audit"]);
    expect(CLIENT_TAB_FALLBACK).toBe("overview");
  });
  it("adds a Consent tab (before Support) only when the consent feature is on", () => {
    const keys = buildClientTabs({ consent: true, openTickets: 0 }).map((t) => t.key);
    expect(keys.indexOf("consent")).toBe(keys.indexOf("support") - 1);
    expect(buildClientTabs({ consent: false, openTickets: 0 }).some((t) => t.key === "consent")).toBe(false);
  });
  it("shows the open-ticket count on Support, and nothing when there are none", () => {
    expect(buildClientTabs({ consent: false, openTickets: 3 }).find((t) => t.key === "support")?.count).toBe(3);
    expect(buildClientTabs({ consent: false, openTickets: 0 }).find((t) => t.key === "support")?.count).toBeNull();
  });
  it("labels match what people already know", () => {
    const labels = Object.fromEntries(buildClientTabs({ consent: true, openTickets: 0 }).map((t) => [t.key, t.label]));
    expect(labels.funding).toBe("Funds & Dealer");
    expect(labels.audit).toBe("Audit History");
  });
});
