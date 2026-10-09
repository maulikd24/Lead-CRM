import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRole = vi.fn();
vi.mock("@/lib/auth/require-role", () => ({ requireRole: (...a: unknown[]) => requireRole(...a) }));
const markContractVerified = vi.fn();
vi.mock("@/lib/partners/contract", async (orig) => ({ ...(await orig<object>()), markContractVerified: (...a: unknown[]) => markContractVerified(...a) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { markPartnerContractVerifiedAction } from "@/app/(dashboard)/settings/integrations/actions";

beforeEach(() => { requireRole.mockReset(); markContractVerified.mockReset(); });

describe("markPartnerContractVerifiedAction", () => {
  it("requires ADMIN before doing anything", async () => {
    requireRole.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(markPartnerContractVerifiedAction({ confirm: true })).rejects.toThrow("NEXT_REDIRECT");
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
    expect(markContractVerified).not.toHaveBeenCalled();
  });
  it("passes the signed-in user and the input through", async () => {
    requireRole.mockResolvedValue({ user: { id: "admin1" } });
    await markPartnerContractVerifiedAction({ confirm: true });
    expect(markContractVerified).toHaveBeenCalledWith(expect.anything(), { confirm: true }, expect.objectContaining({ userId: "admin1" }));
  });
});
