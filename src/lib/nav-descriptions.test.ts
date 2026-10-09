import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "./nav-items";
import { NAV_DESCRIPTIONS } from "./nav-descriptions";

describe("NAV_DESCRIPTIONS", () => {
  it("describes the Agent drafts item in plain words", () => {
    expect(NAV_DESCRIPTIONS["/agents"]).toBe("Drafts an AI assistant prepared for you. Nothing is sent until you approve it.");
  });
  it("every description is non-empty and belongs to a real nav item", () => {
    const hrefs = new Set([...NAV_ITEMS.map((i) => i.href), "/support"]); // /support only exists with NEXT_PUBLIC_SUPPORT_SLA=1
    for (const [href, text] of Object.entries(NAV_DESCRIPTIONS)) {
      expect(hrefs.has(href), href).toBe(true);
      expect(text.trim(), href).not.toBe("");
    }
  });
});
