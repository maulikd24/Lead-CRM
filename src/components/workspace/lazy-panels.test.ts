import { describe, expect, it, vi } from "vitest";

import { lazyPanels, needsServerTrip } from "./lazy-panels";

const keys = ["team", "pipeline", "myday"] as const;

describe("lazyPanels", () => {
  const make = () => ({ team: vi.fn(() => "T"), pipeline: vi.fn(() => "P"), myday: vi.fn(() => "M") });

  it("builds only the requested tab, so the others are never rendered or queried", () => {
    const b = make();
    const out = lazyPanels(keys, "pipeline", "team", b);
    expect(out).toEqual({ team: null, pipeline: "P", myday: null });
    expect(b.pipeline).toHaveBeenCalledTimes(1);
    expect(b.team).not.toHaveBeenCalled();
    expect(b.myday).not.toHaveBeenCalled();
  });
  it("falls back to the default tab for a missing, unknown or repeated parameter (a hand-edited deep link never breaks the page)", () => {
    for (const requested of [undefined, "nope", "", ["bad", "pipeline"]]) {
      const b = make();
      expect(lazyPanels(keys, requested, "team", b).team).toBe("T");
      expect(b.pipeline).not.toHaveBeenCalled();
    }
  });
  it("takes the first value of a repeated parameter", () => {
    expect(lazyPanels(keys, ["myday", "team"], "team", make()).myday).toBe("M");
  });
  it("leaves a tab without a builder empty", () => {
    expect(lazyPanels(["a", "b"], "a", "a", { a: () => 1 })).toEqual({ a: 1, b: null });
  });
});

describe("needsServerTrip", () => {
  it("a lazy workspace asks the server for a tab it has not been given", () => {
    expect(needsServerTrip(true, { a: "x", b: null }, "b")).toBe(true);
    expect(needsServerTrip(true, { a: "x", b: undefined }, "b")).toBe(true);
  });
  it("a lazy workspace that already holds the tab does not", () => {
    expect(needsServerTrip(true, { a: "x", b: null }, "a")).toBe(false);
  });
  it("a workspace that is not lazy never does (every panel is already there)", () => {
    expect(needsServerTrip(false, { a: "x", b: null }, "b")).toBe(false);
  });
});
