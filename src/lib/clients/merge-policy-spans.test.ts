import { describe, expect, it } from "vitest";

import { spansOwners } from "./merge-policy";

describe("spansOwners", () => {
  it("is false when both customers share an owner or are both unassigned", () => {
    expect(spansOwners([{ assignedToId: "u1" }, { assignedToId: "u1" }])).toBe(false);
    expect(spansOwners([{ assignedToId: null }, { assignedToId: null }])).toBe(false);
  });
  it("is true for two owners, or an owner and nobody", () => {
    expect(spansOwners([{ assignedToId: "u1" }, { assignedToId: "u2" }])).toBe(true);
    expect(spansOwners([{ assignedToId: "u1" }, { assignedToId: null }])).toBe(true);
  });
});
