import { describe, expect, it } from "vitest";

import { ACTION_TYPES, AutonomyApprovalRequiredError, AutonomyCeilingError, CEILING, assertMayExecute, assertWithinCeiling, ceilingForAction, effectiveLevel } from "./autonomy";

describe("ceilings are enforced in code", () => {
  it("customer sends stop at L4, ad spend at L4, only internal reversible reaches L5", () => {
    expect(CEILING).toEqual({ read: 2, internal_write: 4, internal_reversible: 5, customer_send: 4, ad_spend: 4 });
    for (const [id, a] of Object.entries(ACTION_TYPES)) expect(ceilingForAction(id) === 5, id).toBe(a.class === "internal_reversible");
  });
  it.each(["draft_customer_message", "suggest_reply", "draft_public_post", "change_ad_spend", "propose_internal_record", "summarise_page"] as const)("%s cannot be set to L5", (a) => {
    expect(() => assertWithinCeiling(a, 5)).toThrow(AutonomyCeilingError);
  });
  it("a customer-facing action is never automatic: L5 is refused even if someone stored it", () => {
    expect(() => assertWithinCeiling("draft_customer_message", 5)).toThrow(/ceiling is L4/);
    expect(effectiveLevel({ defaultLevel: 3, maxLevel: 4 }, "draft_customer_message", 5)).toBe(4);
    // even a mistaken registry maximum of 5 cannot lift a customer send above its ceiling
    expect(effectiveLevel({ defaultLevel: 3, maxLevel: 5 }, "draft_customer_message", 5)).toBe(4);
  });
  it("L5 is allowed for an internal reversible action", () => expect(() => assertWithinCeiling("retry_failed_sync", 5)).not.toThrow());
  it("read-only actions stop at L2", () => expect(() => assertWithinCeiling("answer_question", 3)).toThrow(AutonomyCeilingError));
  it.each([-1, 6, 2.5, NaN])("rejects the invalid level %s", (l) => expect(() => assertWithinCeiling("retry_failed_sync", l)).toThrow(AutonomyCeilingError));
  it("an unknown action type is refused", () => expect(() => ceilingForAction("send_money")).toThrow(/Unknown action type/));
});

describe("effectiveLevel", () => {
  it("uses the registry default when nothing is stored, and caps by the agent's own maximum", () => {
    expect(effectiveLevel({ defaultLevel: 3, maxLevel: 4 }, "draft_customer_message", undefined)).toBe(3);
    expect(effectiveLevel({ defaultLevel: 3, maxLevel: 3 }, "draft_customer_message", 4)).toBe(3);
  });
});

describe("executing needs the right level and a human approval", () => {
  it("below L4 nothing executes", () => {
    for (const l of [0, 1, 2, 3]) expect(() => assertMayExecute({ actionType: "draft_customer_message", level: l, approvalRef: "a1" })).toThrow(AutonomyApprovalRequiredError);
  });
  it("a customer send at L4 needs an approval reference", () => {
    expect(() => assertMayExecute({ actionType: "draft_customer_message", level: 4 })).toThrow(/never automatic/);
    expect(() => assertMayExecute({ actionType: "draft_customer_message", level: 4, approvalRef: "" })).toThrow(AutonomyApprovalRequiredError);
    expect(() => assertMayExecute({ actionType: "draft_customer_message", level: 4, approvalRef: "appr-1" })).not.toThrow();
  });
  it("an ad-spend change needs one too, and can never be L5", () => {
    expect(() => assertMayExecute({ actionType: "change_ad_spend", level: 4 })).toThrow(AutonomyApprovalRequiredError);
    expect(() => assertMayExecute({ actionType: "change_ad_spend", level: 5, approvalRef: "x" })).toThrow(AutonomyCeilingError);
  });
  it("an internal reversible action may run unattended at L5, but at L4 it needs approval", () => {
    expect(() => assertMayExecute({ actionType: "retry_failed_sync", level: 5 })).not.toThrow();
    expect(() => assertMayExecute({ actionType: "retry_failed_sync", level: 4 })).toThrow(AutonomyApprovalRequiredError);
  });
});
