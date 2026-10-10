import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
const decideApproval = vi.fn();
vi.mock("@/lib/policy/approvals/service", async (orig) => ({ ...(await orig<object>()), decideApproval: (...a: unknown[]) => decideApproval(...a) }));

import { ApprovalBlockedError } from "@/lib/policy/approvals/service";
import { decideApprovalAction } from "./actions";

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
});

describe("decideApprovalAction", () => {
  it.each(["FINANCE", "MANAGER", "RM", "PARTNER"] as const)("is for admins only: %s is bounced", async (role) => {
    asUser({ role });
    expect((await outcomeOf(() => decideApprovalAction("r1", "APPROVED"))).kind).toBe("redirect");
    expect(decideApproval).not.toHaveBeenCalled();
  });
  it("sends a signed-out visitor away", async () => {
    asAnonymous();
    expect((await outcomeOf(() => decideApprovalAction("r1", "APPROVED"))).kind).toBe("redirect");
  });
  it("passes the decision, the note, the actor and the typed hold override to the approval service", async () => {
    const admin = asUser({ role: "ADMIN" });
    const r = await decideApprovalAction("r1", "APPROVED", "ok", { holdOverrideReason: "Bank confirmed by phone call" });
    expect(r).toEqual({ ok: true });
    expect(decideApproval).toHaveBeenCalledWith("r1", "APPROVED", "ok", { id: admin.id, role: "ADMIN" }, { holdOverrideReason: "Bank confirmed by phone call" });
  });
  it("turns a blocked approval into a plain result with the reasons, so the screen can ask for an override", async () => {
    asUser({ role: "ADMIN" });
    decideApproval.mockRejectedValue(new ApprovalBlockedError("This payout run has holds, so it cannot be approved yet.", ["PTR-2: Partner is suspended"]));
    expect(await decideApprovalAction("r1", "APPROVED")).toEqual({ ok: false, message: "This payout run has holds, so it cannot be approved yet.", blocked: ["PTR-2: Partner is suspended"] });
  });
  it("still throws for any other failure", async () => {
    asUser({ role: "ADMIN" });
    decideApproval.mockRejectedValue(new Error("Maker cannot also be checker of their own request"));
    expect((await outcomeOf(() => decideApprovalAction("r1", "APPROVED"))).kind).toBe("threw");
  });
});
