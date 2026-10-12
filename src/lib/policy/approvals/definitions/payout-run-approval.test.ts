import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: { marker: "prisma" } }));
const check = vi.fn();
vi.mock("@/lib/partners/holds", () => ({ checkPayoutRunHolds: (...a: unknown[]) => check(...a) }));

import { getApprovalDefinition } from "../registry";
import "./payout-run-approval";

beforeEach(() => vi.clearAllMocks());

describe("payout run approval", () => {
  it("is decided by an Admin only, as before", () => {
    const def = getApprovalDefinition("PAYOUT_ADJUSTMENT");
    expect(def.canDecide({ id: "u", role: "ADMIN" })).toBe(true);
    expect(def.canDecide({ id: "u", role: "FINANCE" })).toBe(false);
  });
  it("runs the hold rules before the approval is recorded, with the actor and the typed override", async () => {
    const def = getApprovalDefinition("PAYOUT_ADJUSTMENT");
    await def.precheck!({ payoutRunId: "run1" }, { actor: { id: "u", role: "ADMIN" }, options: { holdOverrideReason: "Bank confirmed by phone" } });
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ marker: "prisma" }), "run1", { actor: { id: "u", role: "ADMIN" }, options: { holdOverrideReason: "Bank confirmed by phone" } });
  });
  it("lets the hold error stop the approval", async () => {
    check.mockRejectedValue(new Error("blocked"));
    await expect(getApprovalDefinition("PAYOUT_ADJUSTMENT").precheck!({ payoutRunId: "run1" }, { actor: { id: "u", role: "ADMIN" } })).rejects.toThrow("blocked");
  });
});
