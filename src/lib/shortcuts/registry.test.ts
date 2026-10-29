import { describe, expect, it } from "vitest";

import { ALL_ROLES } from "@/lib/access/policy";
import { NAV_FLAGS } from "@/lib/nav-flags";
import { navEntriesFor } from "@/lib/nav/model";
import { shortcutsFor } from "./registry";

const FLAGS = Object.keys(NAV_FLAGS);

describe("global shortcuts", () => {
  it("never go further than the sidebar: every Go to target is a page the role can open", () => {
    for (const role of ALL_ROLES) {
      const hrefs = new Set(navEntriesFor(role, FLAGS).filter((e) => e.state !== "off").map((e) => e.href));
      // A view of a page (/clients?view=board) counts as that page.
      for (const s of shortcutsFor(role, FLAGS, true)) if (s.kind === "go") expect(hrefs.has(s.href) || hrefs.has(s.href.split("?")[0]), `${role} ${s.id}`).toBe(true);
    }
  });
  it("matches are unique per role", () => {
    for (const role of ALL_ROLES) {
      const m = shortcutsFor(role, FLAGS, true).map((s) => s.match);
      expect(new Set(m).size, role).toBe(m.length);
    }
  });
  it("offers C only when the role has something to create", () => {
    expect(shortcutsFor("RM", FLAGS, true).some((s) => s.match === "c")).toBe(true);
    expect(shortcutsFor("PARTNER", FLAGS, false).some((s) => s.match === "c")).toBe(false);
  });
  it("RMs get Clients, Pipeline and Inbox; marketing gets Marketing and Broadcasts but no customer pages", () => {
    const rm = shortcutsFor("RM", FLAGS, true).map((s) => s.match);
    expect(rm).toEqual(expect.arrayContaining(["g h", "g c", "g p", "g i", "g s"]));
    const mk = shortcutsFor("MARKETING", FLAGS, true).map((s) => s.match);
    expect(mk).toEqual(expect.arrayContaining(["g m", "g b", "g h"]));
    expect(mk).not.toContain("g c");
  });
});
