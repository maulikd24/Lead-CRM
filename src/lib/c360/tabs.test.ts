import { describe, expect, it } from "vitest";

import { C360_TABS, parseC360Tab, c360TabHref } from "./tabs";

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
