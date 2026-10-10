import { describe, expect, it } from "vitest";

import { buildDuplicateHints } from "./duplicate-hints";

const row = (over: Partial<Parameters<typeof buildDuplicateHints>[1][number]> = {}) => ({
  suggestionId: "s1",
  partner: { id: "p1", name: "Riya Shah", clientCode: "C-9", assignedToId: "rm-1", isDeleted: false, mergedIntoId: null },
  requested: false,
  ...over,
});

describe("buildDuplicateHints (what an RM sees about possible duplicates of their customer)", () => {
  it("shows a duplicate that is also theirs in full, so they can merge it themselves", () => {
    expect(buildDuplicateHints("rm-1", [row()])).toEqual([{ kind: "yours", suggestionId: "s1", partnerId: "p1", name: "Riya Shah", clientCode: "C-9" }]);
  });
  it("shows a duplicate on another RM's list, or unassigned, as an ask-a-manager item with NOTHING about the other customer", () => {
    const other = buildDuplicateHints("rm-1", [row({ partner: { ...row().partner, assignedToId: "rm-2" } })]);
    const pool = buildDuplicateHints("rm-1", [row({ partner: { ...row().partner, assignedToId: null } })]);
    expect(other).toEqual([{ kind: "elsewhere", suggestionId: "s1", requested: false }]);
    expect(pool).toEqual(other);
    expect(JSON.stringify(other)).not.toMatch(/Riya|C-9|p1|rm-2/);
  });
  it("carries whether a manager was already asked", () => {
    expect(buildDuplicateHints("rm-1", [row({ partner: { ...row().partner, assignedToId: "rm-2" }, requested: true })])).toEqual([{ kind: "elsewhere", suggestionId: "s1", requested: true }]);
  });
  it("ignores merged or archived partners and caps the list", () => {
    expect(buildDuplicateHints("rm-1", [row({ partner: { ...row().partner, isDeleted: true } }), row({ partner: { ...row().partner, mergedIntoId: "z" } })])).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => row({ suggestionId: `s${i}` }));
    expect(buildDuplicateHints("rm-1", many)).toHaveLength(5);
  });
});
