import { describe, expect, it } from "vitest";

import { failClosedCite, getProductCiter, mentionsProduct } from "./product-citation";

describe("product claims: the registry seam fails closed", () => {
  it("the stub treats every product claim as needing registry approval", async () => {
    for (const id of ["anything", "reg_123", ""]) {
      const r = await failClosedCite(id);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("needs_registry_approval");
    }
  });
  it("until the Product Registry is merged the shared citer IS the stub", async () => {
    const r = await getProductCiter()("reg_1");
    expect(r).toEqual({ ok: false, reason: "needs_registry_approval", productId: "reg_1" });
  });
  it("a promise that names an investment product is detected, a tool promise is not", () => {
    expect(mentionsProduct({ mentionsProduct: true, hook: "x", allowedClaims: [] })).toBe(true);
    expect(mentionsProduct({ mentionsProduct: false, hook: "Start a PMS with us", allowedClaims: [] })).toBe(true);
    expect(mentionsProduct({ mentionsProduct: false, hook: "x", allowedClaims: ["Learn about ELSS lock-ins"] })).toBe(true);
    expect(mentionsProduct({ mentionsProduct: false, hook: "See if you are on track for retirement", allowedClaims: ["Takes about a minute"] })).toBe(false);
  });
});
