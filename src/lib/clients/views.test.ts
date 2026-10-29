import { describe, expect, it } from "vitest";

import { canonicalViewQuery, cleanViewName, clientsHref, parseClientView, parseDensity, withParam } from "./views";

describe("clients views", () => {
  it("parses the view and density, defaulting to list and comfortable", () => {
    expect([parseClientView("board"), parseClientView(["board"]), parseClientView("grid"), parseClientView(undefined)]).toEqual(["board", "board", "list", "list"]);
    expect([parseDensity("compact"), parseDensity("tiny"), parseDensity(undefined)]).toEqual(["compact", "comfortable", "comfortable"]);
  });

  it("canonical query: known keys only, trimmed, sorted, no paging, list left out", () => {
    expect(canonicalViewQuery({ stage: "s1", page: "3", evil: "x", priority: " HIGH ", q: "", view: "list" })).toBe("priority=HIGH&stage=s1");
    expect(canonicalViewQuery(new URLSearchParams("view=board&rm=u1&sla=OVERDUE"))).toBe("rm=u1&sla=OVERDUE&view=board");
  });

  it("the same filters in two orders are the same view", () => {
    expect(canonicalViewQuery({ a: "1", stage: "s", rm: "u" })).toBe(canonicalViewQuery({ rm: "u", stage: "s" }));
  });

  it("switches view or a filter and drops paging", () => {
    expect(withParam({ stage: "s1", page: "2" }, "view", "board")).toBe("/clients?stage=s1&view=board");
    expect(withParam({ stage: "s1", view: "board" }, "view", null)).toBe("/clients?stage=s1");
    expect(clientsHref("")).toBe("/clients");
  });

  it("cleans saved view names", () => {
    expect(cleanViewName("  My   hot leads ")).toBe("My hot leads");
    expect(cleanViewName("x")).toBeNull();
    expect(cleanViewName(42)).toBeNull();
    expect(cleanViewName("a".repeat(60))).toHaveLength(40);
  });
});
