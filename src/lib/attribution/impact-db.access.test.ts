import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => new Proxy({}, { get: () => { throw new Error("the database must not be touched"); } }));
vi.mock("@/lib/db/prisma", () => ({ prisma }));

import { loadImpact } from "./impact-db";

const range = { from: "2027-03-22", to: "2027-04-20" };

beforeEach(() => vi.clearAllMocks());

describe("loadImpact access", () => {
  it.each(["RM", "MANAGER", "FINANCE", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", ""])("refuses the %s role before reading any spend", async (role) => {
    await expect(loadImpact(range, { id: "u1", role })).rejects.toThrow(/Not allowed/);
  });
});
