import { describe, expect, it } from "vitest";

import { resolveMatch } from "./match";

describe("resolveMatch", () => {
  it("matches when identifiers agree", () => {
    expect(resolveMatch({ pan: ["c1"], phoneKey: ["c1"] })).toEqual({ status: "matched", clientId: "c1" });
  });
  it("ignores an identifier that matched nobody when another matched", () => {
    expect(resolveMatch({ pan: ["c1"], email: [] })).toEqual({ status: "matched", clientId: "c1" });
  });
  it("is unmatched when nothing matched", () => {
    expect(resolveMatch({ pan: [], email: [] })).toEqual({ status: "unmatched" });
    expect(resolveMatch({})).toEqual({ status: "unmatched" });
  });
  it("is ambiguous when identifiers point at different customers", () => {
    expect(resolveMatch({ pan: ["c1"], email: ["c2"] })).toEqual({ status: "ambiguous" });
  });
  it("is ambiguous when one identifier matches several customers", () => {
    expect(resolveMatch({ phoneKey: ["c1", "c2"] })).toEqual({ status: "ambiguous" });
  });
});
