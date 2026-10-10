import { describe, expect, it } from "vitest";

import { INSIGHTS_TABS } from "./tabs";

describe("INSIGHTS_TABS", () => {
  it("lists Overview, Replies, Conversion and Cost and quality in that order", () => {
    expect(INSIGHTS_TABS.map((t) => t.label)).toEqual(["Overview", "Replies", "Conversion", "Cost and quality"]);
  });
  it("has unique keys, the first being the default", () => {
    expect(new Set(INSIGHTS_TABS.map((t) => t.key)).size).toBe(INSIGHTS_TABS.length);
    expect(INSIGHTS_TABS[0].key).toBe("overview");
  });
});
