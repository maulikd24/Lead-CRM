import { describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => new Proxy({}, { get: () => { throw new Error("the search touched the database before checking the role"); } }));
vi.mock("@/lib/db/prisma", () => ({ prisma }));

import { ALL_ROLES } from "@/lib/access/policy";
import { searchCampaignNames } from "./campaign-search";

describe("campaign search answers only ADMIN and MARKETING, checking the role before it queries", () => {
  it.each(ALL_ROLES.filter((r) => r !== "ADMIN" && r !== "MARKETING"))("returns nothing for %s without touching the database", async (role) => {
    await expect(searchCampaignNames(role, "diwali")).resolves.toEqual([]);
  });
});
