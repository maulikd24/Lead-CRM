import { describe, expect, it } from "vitest";
import { assertWriteAllowed, clevertapHost, isIndiaRegion, normalizeRegion } from "./region";

describe("clevertap region policy", () => {
  it("maps regions to API hosts", () => {
    expect(clevertapHost("in1")).toBe("in1.api.clevertap.com");
    expect(clevertapHost("eu1")).toBe("eu1.api.clevertap.com");
    expect(clevertapHost("")).toBe("api.clevertap.com");
  });
  it("normalises case and spaces", () => {
    expect(normalizeRegion("  IN1 ")).toBe("in1");
    expect(normalizeRegion(undefined)).toBe("");
  });
  it("treats only in1 as India", () => {
    expect(isIndiaRegion("in1")).toBe(true);
    expect(isIndiaRegion(" IN1 ")).toBe(true);
    for (const r of ["", "eu1", "us1", "sg1", "aps3", "mec1", "in", "india", undefined, null]) expect(isIndiaRegion(r)).toBe(false);
  });
  it("blocks writes everywhere except India", () => {
    expect(() => assertWriteAllowed("in1")).not.toThrow();
    for (const r of ["", "eu1", "EU1", "us1", undefined]) expect(() => assertWriteAllowed(r)).toThrow(/India/);
  });
  it("rejects hostile region strings when building a host", () => {
    expect(() => clevertapHost("evil.com/")).toThrow(/Invalid CleverTap region/);
    expect(() => clevertapHost("in1.evil.com#")).toThrow(/Invalid CleverTap region/);
  });
});
