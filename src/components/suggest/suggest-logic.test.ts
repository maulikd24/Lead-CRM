import { describe, expect, it } from "vitest";

import { DISMISSED, SNOOZE_MS, hideItem, parseHidden, restoreItem, swipeOutcome, visibleItems, type Hidden } from "./suggest-logic";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
const NOW = 1_000_000;

describe("visibleItems", () => {
  it("drops dismissed items and items still snoozed, keeps the order", () => {
    const hidden: Hidden = { a: DISMISSED, b: NOW + 5 };
    expect(visibleItems(items, hidden, NOW).map((i) => i.id)).toEqual(["c"]);
  });
  it("brings a snoozed item back once its time is up", () => {
    expect(visibleItems(items, { b: NOW - 1 }, NOW).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("hideItem and restoreItem", () => {
  it("snoozes for a day and dismisses for good, without touching the input", () => {
    const h: Hidden = {};
    expect(hideItem(h, "a", "snooze", NOW)).toEqual({ a: NOW + SNOOZE_MS });
    expect(hideItem(h, "a", "dismiss", NOW)).toEqual({ a: DISMISSED });
    expect(h).toEqual({});
  });
  it("restores an item (the Undo)", () => {
    expect(restoreItem({ a: DISMISSED, b: 5 }, "a")).toEqual({ b: 5 });
  });
});

describe("parseHidden", () => {
  it("keeps live entries, drops expired snoozes, and survives garbage", () => {
    expect(parseHidden(JSON.stringify({ a: DISMISSED, b: NOW + 10, c: NOW - 10, d: "x" }), NOW)).toEqual({ a: DISMISSED, b: NOW + 10 });
    expect(parseHidden("nope", NOW)).toEqual({});
    expect(parseHidden(null, NOW)).toEqual({});
    expect(parseHidden("[1]", NOW)).toEqual({});
  });
});

describe("swipeOutcome", () => {
  it("accepts on a long swipe right, dismisses on a long swipe left, and otherwise springs back", () => {
    expect(swipeOutcome(120, 300)).toBe("accept");
    expect(swipeOutcome(-120, 300)).toBe("dismiss");
    expect(swipeOutcome(40, 300)).toBe("none");
    expect(swipeOutcome(-40, 300)).toBe("none");
  });
  it("scales the threshold to a narrow card", () => {
    expect(swipeOutcome(70, 200)).toBe("accept");
  });
});
