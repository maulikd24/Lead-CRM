import { describe, expect, it } from "vitest";

import { resolveMatch } from "./match";

describe("resolveMatch", () => {
  it("matches on a strong id", () => {
    expect(resolveMatch({ clientCode: ["c1"] })).toEqual({ status: "matched", clientId: "c1" });
    expect(resolveMatch({ pan: ["c1"] })).toEqual({ status: "matched", clientId: "c1" });
    expect(resolveMatch({ clientCode: ["c1"], pan: ["c1"] })).toEqual({ status: "matched", clientId: "c1" });
  });
  it("never writes on mobile or email alone", () => {
    expect(resolveMatch({ phoneKey: ["c1"] })).toEqual({ status: "unmatched", code: "NO_STRONG_ID" });
    expect(resolveMatch({ email: ["c1"], phoneKey: ["c1"] })).toEqual({ status: "unmatched", code: "NO_STRONG_ID" });
    expect(resolveMatch({})).toEqual({ status: "unmatched", code: "NO_STRONG_ID" });
  });
  it("a strong id that matches nobody is unmatched even when mobile or email match someone", () => {
    expect(resolveMatch({ clientCode: [], phoneKey: ["c9"] })).toEqual({ status: "unmatched" });
    expect(resolveMatch({ pan: [], email: ["c9"] })).toEqual({ status: "unmatched" });
    expect(resolveMatch({ clientCode: ["c1"], pan: [] })).toEqual({ status: "unmatched" });
  });
  it("clientCode and pan pointing at different customers is ambiguous", () => expect(resolveMatch({ clientCode: ["c1"], pan: ["c2"] })).toEqual({ status: "ambiguous" }));
  it("a strong id matching several customers is ambiguous", () => expect(resolveMatch({ pan: ["c1", "c2"] })).toEqual({ status: "ambiguous" }));
  it("mobile or email that match only a different customer make it ambiguous", () => {
    expect(resolveMatch({ clientCode: ["c1"], phoneKey: ["c2"] })).toEqual({ status: "ambiguous" });
    expect(resolveMatch({ pan: ["c1"], email: ["c2"] })).toEqual({ status: "ambiguous" });
  });
  it("mobile or email matching nobody (a new number) corroborates nothing and does not block", () => {
    expect(resolveMatch({ clientCode: ["c1"], phoneKey: [], email: [] })).toEqual({ status: "matched", clientId: "c1" });
  });
  it("a shared mobile (all ids returned) that includes the strong customer still matches; one that excludes it does not", () => {
    expect(resolveMatch({ clientCode: ["c1"], phoneKey: ["c1", "c2"] })).toEqual({ status: "matched", clientId: "c1" });
    expect(resolveMatch({ clientCode: ["c1"], phoneKey: ["c2", "c3"] })).toEqual({ status: "ambiguous" });
  });
});
