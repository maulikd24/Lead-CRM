import { describe, expect, it } from "vitest";

import { canAccessReview } from "./access";

describe("canAccessReview", () => {
  it("is open to an unrestricted viewer", () => expect(canAccessReview(null, { assignedRmId: "rm-9" })).toBe(true));
  it("is open for a review in the viewer's scope and for an unowned one", () => {
    expect(canAccessReview(["m", "rm-1"], { assignedRmId: "rm-1" })).toBe(true);
    expect(canAccessReview(["m", "rm-1"], { assignedRmId: null })).toBe(true);
  });
  it("is closed for a review owned by someone outside the scope", () => expect(canAccessReview(["m", "rm-1"], { assignedRmId: "rm-9" })).toBe(false));
});
