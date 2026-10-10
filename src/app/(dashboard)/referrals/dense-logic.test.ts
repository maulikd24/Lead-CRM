import { describe, expect, it } from "vitest";

import { nextItem, pickSelected, viewAllLabel } from "./dense-logic";

const ids = ["a", "b", "c"];
describe("pickSelected", () => {
  it("keeps a requested item that exists, else the first, else nothing", () => {
    expect(pickSelected(ids, "b")).toBe("b");
    expect(pickSelected(ids, "zzz")).toBe("a");
    expect(pickSelected(ids, null)).toBe("a");
    expect(pickSelected(ids, undefined)).toBe("a");
    expect(pickSelected([], "a")).toBeNull();
  });
});
describe("nextItem", () => {
  it("moves by one with Up/Down and jumps with Home/End, staying inside the list", () => {
    expect(nextItem(ids, "a", "ArrowDown")).toBe("b");
    expect(nextItem(ids, "b", "ArrowUp")).toBe("a");
    expect(nextItem(ids, "a", "End")).toBe("c");
    expect(nextItem(ids, "c", "Home")).toBe("a");
  });
  it("returns null at the edges, for other keys and for an unknown current item", () => {
    expect(nextItem(ids, "a", "ArrowUp")).toBeNull();
    expect(nextItem(ids, "c", "ArrowDown")).toBeNull();
    expect(nextItem(ids, "a", "Enter")).toBeNull();
    expect(nextItem(ids, "zzz", "ArrowDown")).toBeNull();
    expect(nextItem([], "a", "ArrowDown")).toBeNull();
  });
});
describe("viewAllLabel", () => {
  it("names the total and the thing", () => expect(viewAllLabel(12, "referrers")).toBe("View all (12) referrers"));
});
