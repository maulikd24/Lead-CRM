import { describe, expect, it } from "vitest";

import { validateFlags } from "./validate";

describe("NEXT_PUBLIC_LANDING and the trust-strip sign-off", () => {
  it("warns (never errors) when the front door is on, because the sign-off lives in the database", () => {
    const r = validateFlags({ NEXT_PUBLIC_LANDING: "1" });
    expect(r.warnings.some((w) => w.flag === "NEXT_PUBLIC_LANDING" && /trust strip/.test(w.message))).toBe(true);
    expect(r.errors.filter((e) => e.flag === "NEXT_PUBLIC_LANDING")).toEqual([]);
  });
  it("says nothing when the front door is off", () => {
    expect(validateFlags({}).warnings.some((w) => w.flag === "NEXT_PUBLIC_LANDING")).toBe(false);
  });
});
