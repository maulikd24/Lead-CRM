import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "./nav-items";
import { NAV_DESCRIPTIONS } from "./nav-descriptions";

describe("NAV_DESCRIPTIONS", () => {
  it("describes the Agent drafts item in plain words", () => {
    expect(NAV_DESCRIPTIONS["/agents"]).toBe("Drafts an AI assistant prepared for you. Nothing is sent until you approve it.");
  });
  it("describes the flagged Call recordings item in plain words", () => {
    expect(NAV_DESCRIPTIONS["/calls"]).toBe("Listen back to call recordings, read transcripts and review how each call was scored.");
  });
  it("every description is non-empty and belongs to a real nav item (flagged items are always in NAV_ITEMS)", () => {
    const hrefs = new Set(NAV_ITEMS.map((i) => i.href));
    for (const [href, text] of Object.entries(NAV_DESCRIPTIONS)) {
      expect(hrefs.has(href), href).toBe(true);
      expect(text.trim(), href).not.toBe("");
    }
  });
});

describe("duplicate review description", () => {
  it("warns that a merge cannot be undone", () => {
    expect(NAV_DESCRIPTIONS["/clients/duplicates"]).toContain("cannot be undone");
  });
});
