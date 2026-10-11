import { describe, expect, it } from "vitest";

import { attributionEnabled } from "./flag";

describe("attributionEnabled", () => {
  it("is off unless the build flag is exactly 1", () => {
    expect(attributionEnabled({})).toBe(false);
    expect(attributionEnabled({ NEXT_PUBLIC_ATTRIBUTION: "" })).toBe(false);
    expect(attributionEnabled({ NEXT_PUBLIC_ATTRIBUTION: "true" })).toBe(false);
    expect(attributionEnabled({ NEXT_PUBLIC_ATTRIBUTION: "0" })).toBe(false);
    expect(attributionEnabled({ NEXT_PUBLIC_ATTRIBUTION: "1" })).toBe(true);
  });
});
