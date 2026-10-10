import { describe, expect, it } from "vitest";

import { TABS, parseChannelFilter, parseTab, parseView, workspaceHref } from "./workspace-params";

describe("parseTab", () => {
  it("defaults to the overview and accepts the four tabs", () => {
    expect(parseTab({}, { social: true })).toBe("overview");
    for (const t of ["overview", "campaigns", "creative", "posts"]) expect(parseTab({ tab: t }, { social: true })).toBe(t);
  });
  it("junk, arrays and the posts tab with social drafts switched off all fall back to the overview", () => {
    expect(parseTab({ tab: "nope" }, { social: true })).toBe("overview");
    expect(parseTab({ tab: ["posts", "x"] }, { social: true })).toBe("overview");
    expect(parseTab({ tab: "posts" }, { social: false })).toBe("overview");
  });
  it("lists the tabs in order, hiding Posts when social drafts are off", () => {
    expect(TABS({ social: true }).map((t) => t.key)).toEqual(["overview", "campaigns", "creative", "posts"]);
    expect(TABS({ social: false }).map((t) => t.key)).toEqual(["overview", "campaigns", "creative"]);
  });
});

describe("parseChannelFilter", () => {
  it("accepts only an enabled channel", () => {
    expect(parseChannelFilter({ channel: "google" }, ["meta", "google"])).toBe("google");
    expect(parseChannelFilter({ channel: "google" }, ["meta"])).toBe("all");
    expect(parseChannelFilter({ channel: "x" }, ["meta", "google"])).toBe("all");
    expect(parseChannelFilter({}, ["meta"])).toBe("all");
  });
});

describe("parseView", () => {
  it("is the board unless the calendar is asked for", () => {
    expect(parseView({})).toBe("board");
    expect(parseView({ view: "calendar" })).toBe("calendar");
    expect(parseView({ view: "grid" })).toBe("board");
  });
});

describe("workspaceHref", () => {
  it("builds a link that keeps the range and drops empty parts", () => {
    expect(workspaceHref({ tab: "campaigns", range: { from: "2026-10-01", to: "2026-10-09", preset: "custom" } })).toBe("/marketing?tab=campaigns&from=2026-10-01&to=2026-10-09");
    expect(workspaceHref({ tab: "overview", range: { from: "a", to: "b", preset: "7d" } })).toBe("/marketing?range=7d");
    expect(workspaceHref({ tab: "posts", view: "calendar", month: "2026-10", post: "p1" })).toBe("/marketing?tab=posts&view=calendar&month=2026-10&post=p1");
    expect(workspaceHref({ tab: "campaigns", channel: "google", range: { from: "a", to: "b", preset: "30d" } })).toBe("/marketing?tab=campaigns&range=30d&channel=google");
  });
  it("the default tab needs no tab parameter, and a bare call is the plain page", () => {
    expect(workspaceHref({})).toBe("/marketing");
  });
  it("encodes values", () => {
    expect(workspaceHref({ tab: "posts", post: "a b&c" })).toBe("/marketing?tab=posts&post=a%20b%26c");
  });
});
