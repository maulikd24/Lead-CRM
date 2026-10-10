import { describe, expect, it } from "vitest";
import { matchesPaletteQuery, orderPaletteItems } from "./order-items";

describe("matchesPaletteQuery", () => {
  it("matches everything for an empty query and is case-insensitive otherwise", () => {
    expect(matchesPaletteQuery("Dashboard", "")).toBe(true);
    expect(matchesPaletteQuery("Dashboard", "  ")).toBe(true);
    expect(matchesPaletteQuery("Dashboard", "dash")).toBe(true);
    expect(matchesPaletteQuery("Dashboard", "find riya sharma")).toBe(false);
  });
});

describe("orderPaletteItems", () => {
  const parts = { clients: ["c1"], nav: ["n1"], ask: ["ask"], actions: ["a1"] };
  it("puts Ask after client and page matches, before generic actions", () => {
    expect(orderPaletteItems(parts)).toEqual(["c1", "n1", "ask", "a1"]);
  });
  it("Ask is first (default-selected) only when there are no client or page matches", () => {
    expect(orderPaletteItems({ ...parts, clients: [], nav: [] })).toEqual(["ask", "a1"]);
  });
  it("a client match is the first item even for a question-shaped query", () => {
    expect(orderPaletteItems({ ...parts, nav: [] })[0]).toBe("c1");
  });
});

describe("recent items", () => {
  it("lead the list, and an omitted recent changes nothing", () => {
    expect(orderPaletteItems({ recent: ["r"], clients: ["c"], nav: ["n"], ask: [], actions: ["a"] })).toEqual(["r", "c", "n", "a"]);
    expect(orderPaletteItems({ clients: ["c"], nav: ["n"], ask: [], actions: [] })).toEqual(["c", "n"]);
  });
});
