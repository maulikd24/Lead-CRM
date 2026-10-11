import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/stage-engine/transitions", () => ({ correctStage: vi.fn() }));
vi.mock("@/lib/partners/holds", () => ({ checkPayoutRunHolds: vi.fn() }));
vi.mock("@/lib/partners/tax/store", () => ({ applyTaxRuleChange: vi.fn(), checkTaxRuleChange: vi.fn() }));
vi.mock("@/lib/partners/overrides/store", () => ({ applyOverrideRuleChange: vi.fn(), checkOverrideRuleChange: vi.fn() }));

import { ALL_ROLES } from "@/lib/access/policy";

import { getApprovalDefinition } from "../registry";
import "../registry-init";
import { definitionOf } from "./definitions";
import { NATIVE_KINDS } from "./native";

describe("native kinds stay pinned to the generic approval registry", () => {
  it.each(Object.entries(NATIVE_KINDS))("%s: same requesters, same approvers, same entity as %s", (kind, actionType) => {
    const legacy = getApprovalDefinition(actionType);
    const canon = definitionOf(kind as never);
    for (const role of ALL_ROLES) {
      const actor = { id: "u", role };
      expect(legacy.canDecide(actor), `decide ${role}`).toBe(canon.approverRoles.includes(role));
      expect(legacy.canRequest(actor), `request ${role}`).toBe(canon.requesterRoles !== "system" && canon.requesterRoles.includes(role));
    }
  });
});
