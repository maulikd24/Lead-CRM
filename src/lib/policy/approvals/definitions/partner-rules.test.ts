import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: { marker: "prisma" } }));
const taxApply = vi.fn();
const taxCheck = vi.fn();
const ovApply = vi.fn();
const ovCheck = vi.fn();
vi.mock("@/lib/partners/tax/store", () => ({ applyTaxRuleChange: (...a: unknown[]) => taxApply(...a), checkTaxRuleChange: (...a: unknown[]) => taxCheck(...a) }));
vi.mock("@/lib/partners/overrides/store", () => ({ applyOverrideRuleChange: (...a: unknown[]) => ovApply(...a), checkOverrideRuleChange: (...a: unknown[]) => ovCheck(...a) }));

import { getApprovalDefinition } from "../registry";
import "./partner-tax-rule";
import "./partner-override-rule";

const roles = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"] as const;
const change = { op: "create", rule: {} };

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["PARTNER_TAX_RULE_CHANGE", "PartnerTaxRule", taxApply, taxCheck],
  ["PARTNER_OVERRIDE_RULE_CHANGE", "PartnerOverrideRule", ovApply, ovCheck],
] as const)("%s", (type, entity, apply, check) => {
  const def = () => getApprovalDefinition(type);
  it("is requested and decided by Admin or Finance only (the service still refuses the same person doing both)", () => {
    expect(def().entity).toBe(entity);
    for (const role of roles) {
      const allowed = role === "ADMIN" || role === "FINANCE";
      expect(def().canRequest({ id: "u", role }), `request ${role}`).toBe(allowed);
      expect(def().canDecide({ id: "u", role }), `decide ${role}`).toBe(allowed);
    }
  });
  it("applies through the store with the database, the change, who decided and the clock", async () => {
    await def().apply(change, { approvalRequestId: "req1", decidedById: "u-checker" });
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ marker: "prisma" }), change, { approvalRequestId: "req1", decidedById: "u-checker" }, expect.any(Date));
  });
  it("checks again before approval", async () => {
    await def().precheck!(change, { actor: { id: "u", role: "ADMIN" } });
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ marker: "prisma" }), change, expect.any(Date));
  });
});
