import { describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => new Proxy({}, { get: () => { throw new Error("the loader touched the database before checking the role"); } }));
vi.mock("@/lib/db/prisma", () => ({ prisma }));

import { ALL_ROLES } from "@/lib/access/policy";
import { AccessDenied } from "@/lib/access/errors";
import { loadAdDeliveryFor, loadCreativesFor } from "./creatives-db";
import { loadMarketingWorkspaceFor } from "./report";

const range = () => ({ from: "2026-10-01", to: "2026-10-07" }) as never;

describe("marketing loaders answer only ADMIN and MARKETING, and check before they query", () => {
  it.each(ALL_ROLES.filter((r) => r !== "ADMIN" && r !== "MARKETING"))("refuses %s without touching the database", async (role) => {
    await expect(loadMarketingWorkspaceFor(role, range)).rejects.toBeInstanceOf(AccessDenied);
    await expect(loadCreativesFor(role, { from: "2026-10-01", to: "2026-10-07" }, ["meta"])).rejects.toBeInstanceOf(AccessDenied);
    await expect(loadAdDeliveryFor(role, { from: "2026-10-01", to: "2026-10-07" }, ["meta"])).rejects.toBeInstanceOf(AccessDenied);
  });
  it("the ad delivery loader (impressions, clicks, day-by-day series for creative) refuses a missing role too", async () => {
    await expect(loadAdDeliveryFor(null, { from: "2026-10-01", to: "2026-10-07" }, ["meta"])).rejects.toBeInstanceOf(AccessDenied);
  });
  it("refuses no role at all", async () => {
    await expect(loadMarketingWorkspaceFor(null, range)).rejects.toBeInstanceOf(AccessDenied);
  });
});
