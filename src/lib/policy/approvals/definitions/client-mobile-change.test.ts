import { describe, expect, it } from "vitest";

import { getApprovalDefinition } from "../registry";
import { mobileChangeDisplay } from "./client-mobile-change";

describe("CLIENT_MOBILE_CHANGE approval", () => {
  const def = getApprovalDefinition("CLIENT_MOBILE_CHANGE");
  it("is requested by an RM or Manager and decided by an Admin only", async () => {
    expect(def.canRequest({ id: "u", role: "RM" })).toBe(true);
    expect(def.canRequest({ id: "u", role: "MANAGER" })).toBe(true);
    expect(def.canRequest({ id: "u", role: "FINANCE" })).toBe(false);
    expect(await def.canDecide({ id: "a", role: "ADMIN" })).toBe(true);
    expect(await def.canDecide({ id: "m", role: "MANAGER" })).toBe(false);
    expect(await def.canDecide({ id: "r", role: "RM" })).toBe(false);
  });
  it("lists show the new number masked, never raw", () => {
    const shown = mobileChangeDisplay({ clientId: "c1", newMobile: "9876543123" });
    expect(JSON.stringify(shown)).not.toContain("9876543123");
    expect(shown.newMobileMasked).toBe("+91 ••••• ••123");
  });
});
