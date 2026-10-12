import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { partnerProfile: { findFirst: (a: unknown) => findFirst(a) } } }));

import { partnerCodeExists, partnerProgrammeLive } from "./partner-probe";

beforeEach(() => vi.clearAllMocks());

describe("the seam to the partner programme", () => {
  it("answers from the real partner table", async () => {
    findFirst.mockResolvedValue({ id: "p1", empanelmentStatus: "ACTIVE" });
    expect(await partnerCodeExists("ptr-00001")).toBe(true);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { partnerCode: { equals: "PTR-00001", mode: "insensitive" } } }));
    findFirst.mockResolvedValue(null);
    expect(await partnerCodeExists("PTR-00009")).toBe(false);
  });
  it("is live only when the partner workspace flag is exactly 1", () => {
    const old = process.env.PARTNER_WORKSPACE_ENABLED;
    process.env.PARTNER_WORKSPACE_ENABLED = "1";
    expect(partnerProgrammeLive()).toBe(true);
    process.env.PARTNER_WORKSPACE_ENABLED = "true";
    expect(partnerProgrammeLive()).toBe(false);
    delete process.env.PARTNER_WORKSPACE_ENABLED;
    expect(partnerProgrammeLive()).toBe(false);
    if (old !== undefined) process.env.PARTNER_WORKSPACE_ENABLED = old;
  });
});
