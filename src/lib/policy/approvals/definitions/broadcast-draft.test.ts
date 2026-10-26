import { describe, expect, it } from "vitest";

import { getApprovalDefinition } from "../registry";
import "./broadcast-draft";

describe("BROADCAST_DRAFT", () => {
  const def = getApprovalDefinition("BROADCAST_DRAFT");
  it("Marketing and Admin request and decide; nobody else", () => {
    for (const role of ["ADMIN", "MARKETING"] as const) {
      expect(def.canRequest({ id: "u", role })).toBe(true);
      expect(def.canDecide({ id: "u", role })).toBe(true);
    }
    for (const role of ["RM", "MANAGER", "FINANCE", "PARTNER"] as const) {
      expect(def.canRequest({ id: "u", role })).toBe(false);
      expect(def.canDecide({ id: "u", role })).toBe(false);
    }
  });
  it("approving sends nothing: apply has no side effect", async () => {
    await expect(def.apply({ name: "x" }, { approvalRequestId: "a", decidedById: "b" })).resolves.toBeUndefined();
  });
});
