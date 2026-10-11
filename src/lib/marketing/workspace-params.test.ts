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

describe("creative and report tabs", () => {
  const all = { social: true, creative: true, reports: true };
  it("are absent unless their switches are on, so with both off nothing changed", () => {
    expect(TABS({ social: true }).map((t) => t.key)).toEqual(["overview", "campaigns", "creative", "posts"]);
    expect(TABS({ social: true, creative: false, reports: false }).map((t) => t.key)).toEqual(["overview", "campaigns", "creative", "posts"]);
  });
  it("appear in order when on", () => {
    expect(TABS(all).map((t) => t.key)).toEqual(["overview", "campaigns", "creative", "intel", "briefs", "experiments", "competitors", "posts", "reports"]);
    expect(TABS({ social: false, creative: true, reports: false }).map((t) => t.key)).toEqual(["overview", "campaigns", "creative", "intel", "briefs", "experiments", "competitors"]);
    expect(TABS({ social: false, creative: false, reports: true }).map((t) => t.key)).toEqual(["overview", "campaigns", "creative", "reports"]);
  });
  it("a deep link to a switched-off tab falls back to the overview", () => {
    for (const t of ["intel", "briefs", "experiments", "competitors"]) {
      expect(parseTab({ tab: t }, { social: true })).toBe("overview");
      expect(parseTab({ tab: t }, { social: true, creative: false, reports: true })).toBe("overview");
      expect(parseTab({ tab: t }, all)).toBe(t);
    }
    expect(parseTab({ tab: "reports" }, { social: true, creative: true })).toBe("overview");
    expect(parseTab({ tab: "reports" }, all)).toBe("reports");
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

describe("Campaign impact tab (flag NEXT_PUBLIC_ATTRIBUTION)", () => {
  it("is not listed while the flag is off, and ?tab=impact falls back to the overview", () => {
    expect(TABS({ social: true }).map((t) => t.key)).toEqual(["overview", "campaigns", "creative", "posts"]);
    expect(parseTab({ tab: "impact" }, { social: true })).toBe("overview");
    expect(parseTab({ tab: "impact" }, { social: true, attribution: false })).toBe("overview");
  });
  it("sits after Creative and before Posts when the flag is on, with its own label", () => {
    expect(TABS({ social: true, attribution: true }).map((t) => t.key)).toEqual(["overview", "campaigns", "creative", "impact", "posts"]);
    expect(TABS({ social: false, attribution: true }).map((t) => t.key)).toEqual(["overview", "campaigns", "creative", "impact"]);
    expect(TABS({ social: false, attribution: true }).find((t) => t.key === "impact")?.label).toBe("Campaign impact");
    expect(parseTab({ tab: "impact" }, { social: false, attribution: true })).toBe("impact");
  });
  it("keeps the compare switch and the selected campaign in its links", () => {
    expect(workspaceHref({ tab: "impact", compare: true })).toBe("/marketing?tab=impact&compare=1");
    expect(workspaceHref({ tab: "impact", campaign: "meta:111" })).toBe("/marketing?tab=impact&campaign=meta%3A111");
  });
});
