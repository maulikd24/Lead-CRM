import { describe, expect, it } from "vitest";

import { DEMO_BANNER_TEXT, demoBannerVisible } from "./banner";

describe("demo banner visibility", () => {
  it("shows only when the demo indicator is exactly 1", () => {
    expect(demoBannerVisible("1")).toBe(true);
    expect(demoBannerVisible("0")).toBe(false);
    expect(demoBannerVisible("true")).toBe(false);
    expect(demoBannerVisible("")).toBe(false);
    expect(demoBannerVisible(undefined)).toBe(false);
  });

  it("says the data is demo data", () => {
    expect(DEMO_BANNER_TEXT).toBe("Demo data: nothing here is a real customer");
  });
});
