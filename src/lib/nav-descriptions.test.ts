import { describe, expect, it, vi } from "vitest";
import { CALLS_REVIEW_NAV_ITEM } from "./nav-items";
import { NAV_DESCRIPTIONS } from "./nav-descriptions";

describe("NAV_DESCRIPTIONS", () => {
  it("describes the Agent drafts item in plain words", () => {
    expect(NAV_DESCRIPTIONS["/agents"]).toBe("Drafts an AI assistant prepared for you. Nothing is sent until you approve it.");
  });
  it("describes the flagged Call recordings item in plain words", () => {
    expect(NAV_DESCRIPTIONS[CALLS_REVIEW_NAV_ITEM.href]).toBe("Listen back to call recordings, read transcripts and review how each call was scored.");
  });
  it("every description is non-empty and belongs to a real nav item", async () => {
    // Flag-gated items only exist in NAV_ITEMS when their flag is on, so check with every flag on.
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MERGE_REVIEW", "1");
    const { NAV_ITEMS } = await import("./nav-items");
    vi.unstubAllEnvs();
    const hrefs = new Set([...NAV_ITEMS, CALLS_REVIEW_NAV_ITEM].map((i) => i.href));
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
