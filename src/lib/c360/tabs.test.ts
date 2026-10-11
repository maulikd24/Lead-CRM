import { describe, expect, it } from "vitest";

import { C360_TABS, c360Tabs, parseC360Tab, c360TabHref } from "./tabs";

describe("Customer 360 tabs", () => {
  it("lists the sections in order, Overview first", () => {
    expect(C360_TABS.map((t) => t.key)).toEqual(["overview", "timeline", "portfolio", "consent", "tickets"]);
    expect(C360_TABS.find((t) => t.key === "tickets")?.label).toBe("Tickets and calls");
  });
  it("reads ?tab= and falls back to Overview for anything unknown", () => {
    expect(parseC360Tab("portfolio")).toBe("portfolio");
    expect(parseC360Tab("nope")).toBe("overview");
    expect(parseC360Tab(undefined)).toBe("overview");
    expect(parseC360Tab(["consent", "timeline"])).toBe("consent");
  });
  it("builds a canonical deep link (Overview has no parameter)", () => {
    expect(c360TabHref("c1", "timeline")).toBe("/clients/c1/360?tab=timeline");
    expect(c360TabHref("c1", "overview")).toBe("/clients/c1/360");
  });
});

describe("Goals and outcomes tab (flag NEXT_PUBLIC_OUTCOMES)", () => {
  it("is not in the list while the flag is off, and ?tab=outcomes falls back to Overview", () => {
    expect(c360Tabs(false).map((t) => t.key)).toEqual(["overview", "timeline", "portfolio", "consent", "tickets"]);
    expect(parseC360Tab("outcomes", false)).toBe("overview");
    expect(parseC360Tab("outcomes")).toBe("overview");
  });
  it("sits after Portfolio when the flag is on and can be opened by link", () => {
    expect(c360Tabs(true).map((t) => t.key)).toEqual(["overview", "timeline", "portfolio", "outcomes", "consent", "tickets"]);
    expect(c360Tabs(true).find((t) => t.key === "outcomes")?.label).toBe("Goals and outcomes");
    expect(parseC360Tab("outcomes", true)).toBe("outcomes");
    expect(c360TabHref("c1", "outcomes")).toBe("/clients/c1/360?tab=outcomes");
  });
});

describe("Memory and Service tabs (flags NEXT_PUBLIC_MEMORY, NEXT_PUBLIC_SERVICE_STATE)", () => {
  const keys = (o: Parameters<typeof c360Tabs>[0]) => c360Tabs(o).map((t) => t.key);
  it("are absent while their flags are off, and ?tab= falls back to Overview", () => {
    expect(keys({})).toEqual(["overview", "timeline", "portfolio", "consent", "tickets"]);
    expect(parseC360Tab("memory", {})).toBe("overview");
    expect(parseC360Tab("service", { memory: true })).toBe("overview");
  });
  it("sit before Consent, Memory first, each only with its own flag", () => {
    expect(keys({ memory: true })).toEqual(["overview", "timeline", "portfolio", "memory", "consent", "tickets"]);
    expect(keys({ service: true })).toEqual(["overview", "timeline", "portfolio", "service", "consent", "tickets"]);
    expect(keys({ memory: true, service: true, outcomes: true })).toEqual(["overview", "timeline", "portfolio", "outcomes", "memory", "service", "consent", "tickets"]);
    expect(parseC360Tab("memory", { memory: true })).toBe("memory");
    expect(c360TabHref("c1", "memory")).toBe("/clients/c1/360?tab=memory");
  });
  it("keeps the original boolean signature working", () => {
    expect(keys(true)).toEqual(["overview", "timeline", "portfolio", "outcomes", "consent", "tickets"]);
  });
});

describe("Journey tab (flag NEXT_PUBLIC_ATTRIBUTION)", () => {
  const keys = (o: Parameters<typeof c360Tabs>[0]) => c360Tabs(o).map((t) => t.key);
  it("is not in the list while the flag is off, and ?tab=journey falls back to Overview", () => {
    expect(keys({})).toEqual(["overview", "timeline", "portfolio", "consent", "tickets"]);
    expect(parseC360Tab("journey", { attribution: false })).toBe("overview");
    expect(parseC360Tab("journey")).toBe("overview");
  });
  it("sits right after Overview when the flag is on and can be opened by link, with outcomes still after Portfolio", () => {
    expect(keys({ attribution: true })).toEqual(["overview", "journey", "timeline", "portfolio", "consent", "tickets"]);
    expect(keys({ outcomes: true, attribution: true })).toEqual(["overview", "journey", "timeline", "portfolio", "outcomes", "consent", "tickets"]);
    expect(parseC360Tab("journey", { attribution: true })).toBe("journey");
    expect(c360TabHref("c1", "journey")).toBe("/clients/c1/360?tab=journey");
  });
});
