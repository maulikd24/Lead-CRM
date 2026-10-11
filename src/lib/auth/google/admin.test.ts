import { describe, expect, it, vi } from "vitest";

import { saveAllowedDomains, type GoogleSettingsDb } from "./admin";

const db = (current: string[] = []): GoogleSettingsDb & { saved: string[][]; audits: unknown[] } => {
  const saved: string[][] = [];
  const audits: unknown[] = [];
  return {
    saved,
    audits,
    read: vi.fn(async () => current),
    write: vi.fn(async (d: string[]) => void saved.push(d)),
    audit: vi.fn(async (e: unknown) => void audits.push(e)),
  };
};
const admin = { id: "a1", role: "ADMIN" };

describe("saveAllowedDomains", () => {
  it("is Admin only", async () => {
    const d = db();
    for (const role of ["MANAGER", "RM", "MARKETING", "FINANCE", ""]) {
      expect(await saveAllowedDomains(d, { id: "u", role }, "corp.example")).toEqual({ ok: false, error: "Only an Admin can change sign-in settings." });
    }
    expect(d.write).not.toHaveBeenCalled();
  });
  it("saves the cleaned list and writes one audit row with old and new values", async () => {
    const d = db(["old.example"]);
    const r = await saveAllowedDomains(d, admin, "Corp.Example, corp.example\nother.example");
    expect(r).toEqual({ ok: true, domains: ["corp.example", "other.example"], changed: true });
    expect(d.saved).toEqual([["corp.example", "other.example"]]);
    expect(d.audits).toEqual([expect.objectContaining({ userId: "a1", action: "google_signin_domains_changed", oldValue: { allowedDomains: ["old.example"] }, newValue: { allowedDomains: ["corp.example", "other.example"] } })]);
  });
  it("refuses anything that is not a plain domain instead of silently dropping it", async () => {
    const d = db();
    const r = await saveAllowedDomains(d, admin, "corp.example, @evil.com, a b");
    expect(r.ok).toBe(false);
    expect(d.write).not.toHaveBeenCalled();
  });
  it("an empty list is allowed and means Google sign-in is off", async () => {
    const d = db(["corp.example"]);
    expect(await saveAllowedDomains(d, admin, "  ")).toEqual({ ok: true, domains: [], changed: true });
  });
  it("makes no change and no audit row when nothing differs", async () => {
    const d = db(["corp.example"]);
    expect(await saveAllowedDomains(d, admin, "CORP.example")).toEqual({ ok: true, domains: ["corp.example"], changed: false });
    expect(d.write).not.toHaveBeenCalled();
    expect(d.audit).not.toHaveBeenCalled();
  });
  it("refuses an over-long list", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `d${i}.example`).join(",");
    expect((await saveAllowedDomains(db(), admin, many)).ok).toBe(false);
  });
});
