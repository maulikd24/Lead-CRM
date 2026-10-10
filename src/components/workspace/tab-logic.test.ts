import { describe, expect, it, vi } from "vitest";

import { createTabKeyHandler, nextTabKey, panelDomId, parseTabParam, tabDomId, tabHref, withTab } from "./tab-logic";

const KEYS = ["overview", "timeline", "portfolio"] as const;

describe("nextTabKey (WAI-ARIA tabs, horizontal)", () => {
  it("moves right and wraps from the last tab to the first", () => {
    expect(nextTabKey(KEYS, "overview", "ArrowRight")).toBe("timeline");
    expect(nextTabKey(KEYS, "portfolio", "ArrowRight")).toBe("overview");
  });
  it("moves left and wraps from the first tab to the last", () => {
    expect(nextTabKey(KEYS, "timeline", "ArrowLeft")).toBe("overview");
    expect(nextTabKey(KEYS, "overview", "ArrowLeft")).toBe("portfolio");
  });
  it("Home and End jump to the ends", () => {
    expect(nextTabKey(KEYS, "timeline", "Home")).toBe("overview");
    expect(nextTabKey(KEYS, "timeline", "End")).toBe("portfolio");
  });
  it("ignores every other key and unknown tabs", () => {
    expect(nextTabKey(KEYS, "overview", "Enter")).toBeNull();
    expect(nextTabKey(KEYS, "overview", "a")).toBeNull();
    expect(nextTabKey(KEYS, "nope", "ArrowRight")).toBe("overview");
    expect(nextTabKey([], "x", "ArrowRight")).toBeNull();
  });
});

describe("createTabKeyHandler", () => {
  const press = (key: string, opts: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => {
    const focusAndActivate = vi.fn();
    const preventDefault = vi.fn();
    createTabKeyHandler({ keys: KEYS, active: "timeline", focusAndActivate })({ key, preventDefault, ctrlKey: false, altKey: false, metaKey: false, ...opts });
    return { focusAndActivate, preventDefault };
  };
  it("focuses and activates the neighbour and stops the page from scrolling", () => {
    const { focusAndActivate, preventDefault } = press("ArrowRight");
    expect(focusAndActivate).toHaveBeenCalledWith("portfolio");
    expect(preventDefault).toHaveBeenCalled();
  });
  it("leaves unrelated keys and modified keys alone", () => {
    expect(press("Tab").focusAndActivate).not.toHaveBeenCalled();
    expect(press("ArrowRight", { altKey: true }).focusAndActivate).not.toHaveBeenCalled();
    expect(press("ArrowLeft", { metaKey: true }).preventDefault).not.toHaveBeenCalled();
  });
});

describe("parseTabParam", () => {
  it("accepts only known tabs", () => {
    expect(parseTabParam("timeline", KEYS, "overview")).toBe("timeline");
    expect(parseTabParam("<script>", KEYS, "overview")).toBe("overview");
    expect(parseTabParam(null, KEYS, "overview")).toBe("overview");
    expect(parseTabParam(undefined, KEYS, "overview")).toBe("overview");
  });
  it("uses the first value when the parameter is repeated", () => {
    expect(parseTabParam(["portfolio", "timeline"], KEYS, "overview")).toBe("portfolio");
  });
});

describe("withTab / tabHref (deep links)", () => {
  it("sets ?tab= and keeps the other parameters", () => {
    expect(withTab("?client=1", "timeline", { fallback: "overview" })).toBe("?client=1&tab=timeline");
    expect(withTab("", "timeline", { fallback: "overview" })).toBe("?tab=timeline");
  });
  it("drops the parameter for the default tab so the canonical URL stays clean", () => {
    expect(withTab("?tab=timeline&x=1", "overview", { fallback: "overview" })).toBe("?x=1");
    expect(withTab("?tab=timeline", "overview", { fallback: "overview" })).toBe("");
  });
  it("replaces an existing value instead of duplicating it", () => {
    expect(withTab("?tab=timeline", "portfolio", { fallback: "overview" })).toBe("?tab=portfolio");
  });
  it("supports another parameter name", () => {
    expect(withTab("", "b", { fallback: "a", param: "section" })).toBe("?section=b");
  });
  it("builds a full href from a pathname", () => {
    expect(tabHref("/clients/1", "?x=1", "consent", { fallback: "overview" })).toBe("/clients/1?x=1&tab=consent");
    expect(tabHref("/clients/1", "?tab=consent", "overview", { fallback: "overview" })).toBe("/clients/1");
  });
});

describe("ids", () => {
  it("links a tab to its panel with stable, prefixed ids", () => {
    expect(tabDomId("c360", "timeline")).toBe("c360-tab-timeline");
    expect(panelDomId("c360", "timeline")).toBe("c360-panel-timeline");
  });
});
