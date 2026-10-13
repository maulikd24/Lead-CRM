import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DemoBanner } from "./demo-banner";
import { DEMO_BANNER_TEXT, demoBannerVisible } from "@/lib/demo/banner";

describe("demo banner", () => {
  it("shows only when the demo indicator is on", () => {
    expect(demoBannerVisible("1")).toBe(true);
    expect(demoBannerVisible("0")).toBe(false);
    expect(demoBannerVisible(undefined)).toBe(false);
  });
  it("renders the demo text when visible", () => {
    expect(renderToStaticMarkup(<DemoBanner visible />)).toContain(DEMO_BANNER_TEXT);
    expect(DEMO_BANNER_TEXT).toBe("Demo data: nothing here is a real customer");
  });
  it("renders nothing outside demo mode", () => {
    expect(renderToStaticMarkup(<DemoBanner visible={false} />)).toBe("");
  });
});
