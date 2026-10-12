import { describe, expect, it, vi } from "vitest";

import { isPartnerCode } from "./is-partner-code";

const db = (rows: Array<{ partnerCode: string; empanelmentStatus: string }>) => ({
  partnerProfile: {
    findFirst: vi.fn(async ({ where }: { where: { partnerCode: { equals: string } } }) => rows.find((r) => r.partnerCode.toUpperCase() === where.partnerCode.equals.toUpperCase()) ?? null),
  },
});

describe("isPartnerCode", () => {
  it("is true for a partner's code in any case, with surrounding spaces", async () => {
    expect(await isPartnerCode(db([{ partnerCode: "PTR-00001", empanelmentStatus: "ACTIVE" }]) as never, "  ptr-00001 ")).toBe(true);
  });
  it("is still true for a partner who is not active: their code is theirs, whatever their status", async () => {
    expect(await isPartnerCode(db([{ partnerCode: "PTR-00002", empanelmentStatus: "SUSPENDED" }]) as never, "PTR-00002")).toBe(true);
  });
  it("is false for a code no partner has", async () => {
    expect(await isPartnerCode(db([]) as never, "PTR-00003")).toBe(false);
  });
  it("is false, without touching the database, for anything that cannot be a partner code", async () => {
    const d = db([{ partnerCode: "PTR-00001", empanelmentStatus: "ACTIVE" }]);
    for (const bad of ["", "  ", "a", "PTR 00001; drop", "x".repeat(70), undefined as unknown as string]) expect(await isPartnerCode(d as never, bad)).toBe(false);
    expect(d.partnerProfile.findFirst).not.toHaveBeenCalled();
  });
});
