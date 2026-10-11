import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());

import { ALL_ROLES } from "@/lib/access/policy";
import { requireMarketing } from "./require-role";

beforeEach(() => resetSession());

describe("requireMarketing: the one gate for marketing screens", () => {
  it.each(["ADMIN", "MARKETING"] as const)("lets %s in", async (role) => {
    asUser({ role });
    expect((await outcomeOf(() => requireMarketing())).kind).toBe("returned");
    expect((await outcomeOf(() => requireMarketing("marketing-social", "manage"))).kind).toBe("returned");
  });
  it.each(ALL_ROLES.filter((r) => r !== "ADMIN" && r !== "MARKETING"))("sends %s to its own home", async (role) => {
    asUser({ role });
    const r = await outcomeOf(() => requireMarketing());
    expect(r.kind).toBe("redirect");
  });
  it("sends a signed-out visitor to the sign-in page and a pending password change to /change-password", async () => {
    asAnonymous();
    expect(await outcomeOf(() => requireMarketing())).toEqual({ kind: "redirect", url: "/login" });
    asUser({ role: "MARKETING", mustChangePassword: true });
    expect(await outcomeOf(() => requireMarketing())).toEqual({ kind: "redirect", url: "/change-password" });
  });
});
