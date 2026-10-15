import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findMany: vi.fn(async () => []) }, team: { findMany: vi.fn(async () => []) }, hierarchyAssignment: { findMany: vi.fn(async () => []) }, partnerProfile: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) } } }));

import { getVisibleUserIds } from "./visibility";
import { getVisibleScope } from "@/lib/policy/visibility";

describe("a marketing user owns no customers and may see nobody's", () => {
  it("gets an empty set of visible owners, never null (which would mean everyone)", async () => {
    expect(await getVisibleUserIds("mkt-1", "MARKETING")).toEqual([]);
  });
  it("gets an empty scope from the generalised visibility rule too", async () => {
    expect(await getVisibleScope("mkt-1", "MARKETING")).toEqual({ userIds: [], partnerProfileIds: null, teamIds: null });
  });
  it("leaves the others as they were", async () => {
    expect(await getVisibleUserIds("rm-1", "RM")).toEqual(["rm-1"]);
    expect(await getVisibleUserIds("a-1", "ADMIN")).toBeNull();
  });
});
