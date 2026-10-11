import { beforeEach, describe, expect, it, vi } from "vitest";

const decide = vi.fn();
const requireAccess = vi.fn();
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/auth/require-role", () => ({ requireAccess: (...a: unknown[]) => requireAccess(...a) }));
vi.mock("@/lib/policy/approvals/canonical/wiring", () => ({ approvalService: () => ({ decide: (...a: unknown[]) => decide(...a) }) }));

import { decideInboxAction } from "./actions";

const session = { user: { id: "u1", role: "RM", name: "Ravi" } };
beforeEach(() => {
  vi.clearAllMocks();
  requireAccess.mockResolvedValue(session);
  decide.mockResolvedValue({ ok: true, state: "executed", approval: null });
  process.env.APPROVALS_INBOX_ENABLED = "1";
});

describe("decideInboxAction", () => {
  it("asks the registry for manage on the approvals area first", async () => {
    await decideInboxAction("agent-proposal:p1", "approve", {});
    expect(requireAccess).toHaveBeenCalledWith("approvals", "manage");
  });

  it("does nothing while the inbox flag is off", async () => {
    delete process.env.APPROVALS_INBOX_ENABLED;
    expect(await decideInboxAction("agent-proposal:p1", "approve", {})).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(decide).not.toHaveBeenCalled();
  });

  it("passes the signed-in person (never one named by the browser), the handle, the decision, the reason and only the known inputs", async () => {
    await decideInboxAction("social-post:x1", "reject", { reason: "  Add the risk line  ", params: { confirmed: true, survivorId: "c1", acknowledged: false, holdOverrideReason: "bank ok", actor: "someone-else", role: "ADMIN", editedBody: "x".repeat(9000), junk: 1 } });
    expect(decide).toHaveBeenCalledTimes(1);
    const [actor, ref, decision, input] = decide.mock.calls[0];
    expect(actor).toEqual({ id: "u1", role: "RM", name: "Ravi" });
    expect(ref).toBe("social-post:x1");
    expect(decision).toBe("reject");
    expect(input.reason).toBe("Add the risk line");
    expect(input.params).toEqual({ confirmed: true, survivorId: "c1", acknowledged: false, holdOverrideReason: "bank ok" });
  });

  it("rejects malformed input before the service is called", async () => {
    for (const bad of [[undefined, "approve"], ["", "approve"], [123, "approve"], ["agent-proposal:p1", "delete"], ["agent-proposal:p1", undefined], ["x".repeat(300), "approve"]] as const) {
      expect(await decideInboxAction(bad[0], bad[1], {}), String(bad)).toMatchObject({ ok: false, code: "INVALID" });
    }
    expect(decide).not.toHaveBeenCalled();
  });

  it("returns the service's refusal untouched, with its reasons", async () => {
    decide.mockResolvedValue({ ok: false, code: "BLOCKED", error: "Blocked", reasons: ["a"] });
    expect(await decideInboxAction("payout-run:r1", "approve", {})).toEqual({ ok: false, code: "BLOCKED", error: "Blocked", reasons: ["a"] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a thrown error becomes a plain refusal, never a leak", async () => {
    decide.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await decideInboxAction("payout-run:r1", "approve", {});
    spy.mockRestore();
    expect(r).toMatchObject({ ok: false, code: "ERROR" });
    expect(JSON.stringify(r)).not.toMatch(/ECONNREFUSED|10\.0/);
  });

  it("on success it refreshes the inbox and the legacy screens, and says what happened in words", async () => {
    const r = await decideInboxAction("agent-proposal:p1", "approve", {});
    expect(r).toMatchObject({ ok: true, state: "executed", message: "Approved and done." });
    for (const p of ["/approvals", "/agents", "/referrals", "/marketing", "/clients/duplicates"]) expect(revalidatePath).toHaveBeenCalledWith(p);
    decide.mockResolvedValue({ ok: true, state: "rejected", approval: null });
    expect(await decideInboxAction("agent-proposal:p2", "reject", { reason: "no" })).toMatchObject({ ok: true, message: "Rejected." });
  });
});
