import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn();
const requireUser = vi.fn();

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { update: (...args: unknown[]) => update(...args) } } }));
vi.mock("@/lib/auth/require-role", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/activity/log-user-event", () => ({ logUserEvent: vi.fn() }));
vi.mock("@/lib/auth/sso", () => ({ ssoConfigFromEnv: vi.fn() }));
vi.mock("@/lib/auth/sso-logout", () => ({ ssoEndSessionUrl: vi.fn() }));

import { markTourSeenAction } from "./actions";

describe("markTourSeenAction (finish and skip both call this)", () => {
  beforeEach(() => {
    update.mockReset();
    requireUser.mockReset();
  });

  it("sets hasSeenTour for the signed-in user only", async () => {
    requireUser.mockResolvedValue({ user: { id: "user-7" } });
    update.mockResolvedValue({});
    await markTourSeenAction();
    expect(update).toHaveBeenCalledWith({ where: { id: "user-7" }, data: { hasSeenTour: true } });
  });

  it("does not write when the access check fails", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(markTourSeenAction()).rejects.toThrow("NEXT_REDIRECT");
    expect(update).not.toHaveBeenCalled();
  });
});
