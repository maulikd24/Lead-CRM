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
