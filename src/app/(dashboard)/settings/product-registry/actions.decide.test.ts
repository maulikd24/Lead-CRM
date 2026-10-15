import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const decideVersion = vi.fn(async () => ({ ok: true as const }));
const canonicalDecide = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, state: "approved", approval: null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireAccess: async () => ({ user: { id: "u-a2", role: "ADMIN", name: "Second Admin" } }) }));
vi.mock("@/lib/registry/service", () => ({ decideVersion: (...a: unknown[]) => (decideVersion as (...x: unknown[]) => unknown)(...a) }));
vi.mock("@/lib/policy/approvals/canonical/wiring", () => ({ approvalService: () => ({ decide: (...a: unknown[]) => canonicalDecide(...a) }) }));

import { decideVersionAction } from "./actions";

describe("approving a registry version goes through the one approval service (Wave 2 integration)", () => {
  beforeEach(() => { decideVersion.mockClear(); canonicalDecide.mockClear(); });
  afterEach(() => { delete process.env.APPROVALS_INBOX_ENABLED; });

  it("with the approvals layer on, the decision is made by the canonical service under the product-registry-change ref", async () => {
    process.env.APPROVALS_INBOX_ENABLED = "1";
    const r = await decideVersionAction("v9", "approve", "");
    expect(r).toMatchObject({ ok: true });
    expect(canonicalDecide).toHaveBeenCalledWith({ id: "u-a2", role: "ADMIN", name: "Second Admin" }, "product-registry-change:v9", "approve", { reason: null });
    expect(decideVersion).not.toHaveBeenCalled(); // the adapter calls the registry, not this action
  });
  it("a refusal from the canonical service (four-eyes, reason) is shown as it is", async () => {
    process.env.APPROVALS_INBOX_ENABLED = "1";
    canonicalDecide.mockResolvedValueOnce({ ok: false, code: "REASON_REQUIRED", error: "Say why you are rejecting this." } as never);
    expect(await decideVersionAction("v9", "reject", "")).toEqual({ ok: false, error: "Say why you are rejecting this." });
  });
  it("with the approvals layer off nothing changes: the registry's own path decides", async () => {
    const r = await decideVersionAction("v9", "approve", "looks right");
    expect(r).toMatchObject({ ok: true });
    expect(decideVersion).toHaveBeenCalledWith("v9", "approve", "looks right", { userId: "u-a2", role: "ADMIN" });
    expect(canonicalDecide).not.toHaveBeenCalled();
  });
});
