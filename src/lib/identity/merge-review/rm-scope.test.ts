import { describe, expect, it } from "vitest";

import { HIDDEN_SIDE, reviewAccess, visibleSide } from "./rm-scope";

const rm = { id: "rm-1", role: "RM" };
const mine = { assignedToId: "rm-1" };
const theirs = { assignedToId: "rm-2" };
const nobody = { assignedToId: null };

describe("reviewAccess", () => {
  it.each(["ADMIN", "MANAGER"])("%s sees any pair in full", (role) => {
    expect(reviewAccess({ id: "x", role }, [theirs, nobody])).toBe("full");
  });
  it("an RM sees a pair in full when both customers are theirs", () => {
    expect(reviewAccess(rm, [mine, mine])).toBe("full");
  });
  it("an RM gets the restricted view when only one customer is theirs, whoever or nobody owns the other", () => {
    expect(reviewAccess(rm, [mine, theirs])).toBe("restricted");
    expect(reviewAccess(rm, [nobody, mine])).toBe("restricted");
  });
  it("an RM with no customer in the pair gets nothing (same as a pair that does not exist)", () => {
    expect(reviewAccess(rm, [theirs, theirs])).toBe("none");
    expect(reviewAccess(rm, [nobody, nobody])).toBe("none");
  });
  it.each(["DEALER", "FINANCE", "PARTNER", "AFFILIATE"])("%s never sees a pair", (role) => {
    expect(reviewAccess({ id: "rm-1", role }, [mine, mine])).toBe("none");
  });
});

describe("visibleSide", () => {
  const side = { id: "c1", first: "Asha", code: "SYN-001" };
  it("shows a side in full to admins, managers and to the RM who owns it", () => {
    expect(visibleSide({ id: "m", role: "MANAGER" }, theirs, side)).toEqual(side);
    expect(visibleSide(rm, mine, side)).toEqual(side);
  });
  it("hides a customer an RM does not own: no id, name or code", () => {
    const hidden = visibleSide(rm, theirs, side);
    expect(hidden).toEqual(HIDDEN_SIDE);
    expect(JSON.stringify(hidden)).not.toMatch(/c1|Asha|SYN-001/);
    expect(visibleSide(rm, nobody, side)).toEqual(HIDDEN_SIDE);
  });
});
