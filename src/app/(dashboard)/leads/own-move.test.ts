import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "RM" as string,
  userId: "rm-1",
  client: null as unknown,
  move: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/leads/kanban-flag", () => ({ kanbanEnabled: () => true }));
vi.mock("@/app/(dashboard)/clients/actions", () => ({ correctStageAction: vi.fn() }));
vi.mock("@/lib/auth/visibility", () => ({ getVisibleUserIds: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async (roles: string[]) => {
    if (!roles.includes(mocks.role)) throw new Error("Forbidden");
    return { user: { id: mocks.userId, role: mocks.role } };
  },
}));
vi.mock("@/lib/stage-engine/transitions", () => ({ moveStageByRm: mocks.move }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    client: { findUnique: async () => mocks.client },
    stage: {
      findMany: async () => [
        { id: "s1", name: "New Lead", sequence: 1 },
        { id: "s2", name: "Submitted for KYC", sequence: 2 },
        { id: "s3", name: "KYC completed", sequence: 3 },
        { id: "s5", name: "Pushed for funds", sequence: 4 },
      ],
    },
  },
}));

import { moveOwnLeadStageAction } from "./actions";

const lead = (over: Record<string, unknown> = {}) => ({ id: "c1", isDeleted: false, status: "ACTIVE", assignedToId: "rm-1", currentStageId: "s2", currentStage: { name: "Submitted for KYC" }, kycRecord: { id: "k" }, ...over });

beforeEach(() => {
  mocks.role = "RM";
  mocks.userId = "rm-1";
  mocks.client = lead();
  mocks.move.mockReset();
});

describe("moveOwnLeadStageAction", () => {
  it("moves the RM's own lead between pre-KYC stages through the audited RM move", async () => {
    const res = await moveOwnLeadStageAction("c1", "s1");
    expect(res).toMatchObject({ ok: true, pendingApproval: false, fromStageId: "s2" });
    expect(mocks.move).toHaveBeenCalledWith("c1", "s1", expect.stringContaining("Submitted for KYC"), "rm-1");
  });
  it("refuses another RM's lead, and an unassigned one, without touching it", async () => {
    mocks.client = lead({ assignedToId: "rm-2" });
    expect((await moveOwnLeadStageAction("c1", "s1")).ok).toBe(false);
    mocks.client = lead({ assignedToId: null });
    expect((await moveOwnLeadStageAction("c1", "s1")).ok).toBe(false);
    expect(mocks.move).not.toHaveBeenCalled();
  });
  it("refuses a skip to a system-controlled stage (KYC completed, funds)", async () => {
    expect((await moveOwnLeadStageAction("c1", "s3")).ok).toBe(false);
    expect((await moveOwnLeadStageAction("c1", "s5")).ok).toBe(false);
    expect(mocks.move).not.toHaveBeenCalled();
  });
  it("refuses a lead already past the pre-KYC stages", async () => {
    mocks.client = lead({ currentStageId: "s5", currentStage: { name: "Pushed for funds" } });
    expect((await moveOwnLeadStageAction("c1", "s1")).ok).toBe(false);
    expect(mocks.move).not.toHaveBeenCalled();
  });
  it("every other role is refused at the door: admin and manager keep their own action", async () => {
    for (const role of ["ADMIN", "MANAGER", "FINANCE", "MARKETING", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "DEALER", "TEAM_MANAGER"]) {
      mocks.role = role;
      await expect(moveOwnLeadStageAction("c1", "s1"), role).rejects.toThrow();
    }
    expect(mocks.move).not.toHaveBeenCalled();
  });
});
