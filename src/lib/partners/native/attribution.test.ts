import { describe, expect, it } from "vitest";

import { escapeLike, funnelOf, maskName, parseSegment, SEGMENTS } from "./attribution";

describe("maskName", () => {
  it("keeps the first name and the initial of the rest", () => expect(maskName("Priya Sharma")).toBe("Priya S."));
  it("handles a single name", () => expect(maskName("Priya")).toBe("Priya"));
  it("handles many parts", () => expect(maskName("Anil Kumar Singh")).toBe("Anil K. S."));
  it("tolerates extra spaces", () => expect(maskName("  Priya   Sharma ")).toBe("Priya S."));
  it("never returns an empty string", () => {
    expect(maskName("")).toBe("Unnamed");
    expect(maskName(null)).toBe("Unnamed");
    expect(maskName("   ")).toBe("Unnamed");
  });
  it("does not leak the surname for a short last part", () => expect(maskName("Li Wu")).toBe("Li W."));
});

describe("funnelOf: where a referred person stands", () => {
  it("is a lead when no account was opened through the partner", () => {
    expect(funnelOf({ via: "LEAD", anyActive: false, accounts: 0, latestStatus: null })).toBe("LEAD");
  });
  it("is active when any sourced account is active", () => {
    expect(funnelOf({ via: "ACCOUNT", anyActive: true, accounts: 2, latestStatus: "CLOSED" })).toBe("ACTIVE");
  });
  it("otherwise reports the latest account status", () => {
    expect(funnelOf({ via: "ACCOUNT", anyActive: false, accounts: 1, latestStatus: "DORMANT" })).toBe("DORMANT");
    expect(funnelOf({ via: "ACCOUNT", anyActive: false, accounts: 1, latestStatus: "CLOSED" })).toBe("CLOSED");
  });
  it("falls back to account opened when the status is unknown", () => {
    expect(funnelOf({ via: "ACCOUNT", anyActive: false, accounts: 1, latestStatus: null })).toBe("ACCOUNT_OPENED");
  });
});

describe("parseSegment", () => {
  it("accepts only known values", () => {
    expect(parseSegment("clients")).toBe("clients");
    expect(parseSegment("leads")).toBe("leads");
    expect(parseSegment("all")).toBe("all");
    expect(parseSegment("x'; drop table")).toBe("all");
    expect(parseSegment(undefined)).toBe("all");
    expect(SEGMENTS.map((s) => s.key)).toEqual(["all", "clients", "leads"]);
  });
});

describe("escapeLike", () => {
  it("escapes the wildcard characters so a search cannot match everything", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });
});
