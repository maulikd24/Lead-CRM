import { describe, expect, it } from "vitest";

import { nativeHref, parseNativeQuery } from "./query";

describe("parseNativeQuery", () => {
  it("returns safe defaults for an empty URL", () => {
    expect(parseNativeQuery({})).toEqual({ q: undefined, offset: 0, status: undefined, tier: undefined, segment: "all", funnel: undefined, partner: undefined, run: undefined, accrual: undefined, view: undefined });
  });
  it("trims and caps the search text", () => {
    expect(parseNativeQuery({ q: "  abc  " }).q).toBe("abc");
    expect(parseNativeQuery({ q: "x".repeat(200) }).q).toHaveLength(80);
    expect(parseNativeQuery({ q: "   " }).q).toBeUndefined();
  });
  it("accepts only known statuses, tiers, segments, funnels and accrual statuses", () => {
    expect(parseNativeQuery({ status: "ACTIVE" }).status).toBe("ACTIVE");
    expect(parseNativeQuery({ status: "DROP TABLE" }).status).toBeUndefined();
    expect(parseNativeQuery({ tier: "GOLD" }).tier).toBe("GOLD");
    expect(parseNativeQuery({ tier: "gold" }).tier).toBeUndefined();
    expect(parseNativeQuery({ segment: "leads" }).segment).toBe("leads");
    expect(parseNativeQuery({ segment: "x" }).segment).toBe("all");
    expect(parseNativeQuery({ funnel: "CLOSED" }).funnel).toBe("CLOSED");
    expect(parseNativeQuery({ funnel: "all" }).funnel).toBeUndefined();
    expect(parseNativeQuery({ funnel: "SIGNED_UP" }).funnel).toBeUndefined();
    expect(parseNativeQuery({ accrual: "REVERSED" }).accrual).toBe("REVERSED");
    expect(parseNativeQuery({ accrual: "nope" }).accrual).toBeUndefined();
  });
  it("accepts a payout status of this system, not another's", () => {
    expect(parseNativeQuery({ status: "RECONCILED_EXTERNALLY" }).status).toBe("RECONCILED_EXTERNALLY");
    expect(parseNativeQuery({ status: "PAID" }).status).toBeUndefined();
  });
  it("accepts ids only in the shape the database uses", () => {
    expect(parseNativeQuery({ partner: "clx0abc123", run: "clx9xyz" })).toMatchObject({ partner: "clx0abc123", run: "clx9xyz" });
    expect(parseNativeQuery({ partner: "a b" }).partner).toBeUndefined();
    expect(parseNativeQuery({ partner: "a'; --" }).partner).toBeUndefined();
    expect(parseNativeQuery({ run: "x".repeat(65) }).run).toBeUndefined();
  });
  it("accepts only the known views", () => {
    expect(parseNativeQuery({ view: "adjustments" }).view).toBe("adjustments");
    expect(parseNativeQuery({ view: "runs" }).view).toBe("runs");
    expect(parseNativeQuery({ view: "x" }).view).toBeUndefined();
  });
  it("clamps the offset", () => {
    expect(parseNativeQuery({ offset: "50" }).offset).toBe(50);
    expect(parseNativeQuery({ offset: "-5" }).offset).toBe(0);
    expect(parseNativeQuery({ offset: "abc" }).offset).toBe(0);
    expect(parseNativeQuery({ offset: "99999999" }).offset).toBe(100000);
  });
  it("takes the first value when a parameter repeats", () => {
    expect(parseNativeQuery({ q: ["one", "two"] }).q).toBe("one");
  });
});

describe("nativeHref", () => {
  it("builds a URL from the non-empty parts, in a stable order", () => {
    expect(nativeHref("/partners/referred-users", { segment: "leads", q: "ab", offset: 25 })).toBe("/partners/referred-users?offset=25&q=ab&segment=leads");
  });
  it("drops empty, undefined, a zero offset and the default segment", () => {
    expect(nativeHref("/partners/x", { q: "", offset: 0, segment: "all", status: undefined })).toBe("/partners/x");
  });
  it("encodes values", () => {
    expect(nativeHref("/p", { q: "a&b c" })).toBe("/p?q=a%26b+c");
  });
});
