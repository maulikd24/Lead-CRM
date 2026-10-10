import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMany = vi.fn();
const update = vi.fn();
const findUnique = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { approvalRequest: { findUnique: (...a: unknown[]) => findUnique(...a), updateMany: (...a: unknown[]) => updateMany(...a), update: (...a: unknown[]) => update(...a) } } }));

import { registerApproval } from "./registry";
import { ApprovalBlockedError, decideApproval } from "./service";

const apply = vi.fn();
const precheck = vi.fn();
registerApproval({ actionType: "PARTNER_TAX_RULE_CHANGE", entity: "PartnerTaxRule", canRequest: () => true, canDecide: () => true, precheck, apply });

const admin = { id: "u-admin", role: "ADMIN" as const };
const req = { id: "r1", actionType: "PARTNER_TAX_RULE_CHANGE", status: "PENDING", requestedById: "u-maker", payload: { n: 1 } };

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(req);
  updateMany.mockResolvedValue({ count: 1 });
  update.mockResolvedValue({});
});

describe("decideApproval with a precheck", () => {
  it("runs the precheck before the request is claimed, passing the payload, the actor and the options", async () => {
    precheck.mockResolvedValue(undefined);
    await decideApproval("r1", "APPROVED", "ok", admin, { holdOverrideReason: "bank confirmed by phone" });
    expect(precheck).toHaveBeenCalledWith({ n: 1 }, { actor: admin, options: { holdOverrideReason: "bank confirmed by phone" } });
    expect(precheck.mock.invocationCallOrder[0]).toBeLessThan(updateMany.mock.invocationCallOrder[0]);
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it("a failing precheck leaves the request pending: it is not claimed and nothing is applied", async () => {
    precheck.mockRejectedValue(new ApprovalBlockedError("Blocked", ["Partner A is suspended"]));
    await expect(decideApproval("r1", "APPROVED", undefined, admin)).rejects.toBeInstanceOf(ApprovalBlockedError);
    expect(updateMany).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
  it("a rejection does not run the precheck: anyone allowed to decide may always reject", async () => {
    await decideApproval("r1", "REJECTED", "no", admin);
    expect(precheck).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalled();
  });
  it("still refuses a maker deciding their own request, before any precheck", async () => {
    await expect(decideApproval("r1", "APPROVED", undefined, { id: "u-maker", role: "ADMIN" })).rejects.toThrow(/Maker cannot also be checker/);
    expect(precheck).not.toHaveBeenCalled();
  });
});

describe("ApprovalBlockedError", () => {
  it("carries the reasons for the screen to show", () => {
    const e = new ApprovalBlockedError("Blocked", ["a", "b"]);
    expect(e.reasons).toEqual(["a", "b"]);
    expect(e.message).toBe("Blocked");
  });
});
