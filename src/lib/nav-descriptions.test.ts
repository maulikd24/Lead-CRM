import { describe, expect, it, vi } from "vitest";
import { NAV_DESCRIPTIONS } from "./nav-descriptions";

describe("NAV_DESCRIPTIONS", () => {
  it("describes the Agent drafts item in plain words", () => {
    expect(NAV_DESCRIPTIONS["/agents"]).toBe("Drafts an AI assistant prepared for you. Nothing is sent until you approve it.");
  });
  it("every description is non-empty and belongs to a real nav item", async () => {
    // Flag-gated items only exist in NAV_ITEMS when their flag is on, so check with every flag on.
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MERGE_REVIEW", "1");
    const { NAV_ITEMS } = await import("./nav-items");
    vi.unstubAllEnvs();
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
