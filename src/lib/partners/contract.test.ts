import { describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, isContractVerified, markContractVerified } from "./contract";

describe("isContractVerified", () => {
  it("needs a valid date and the current version", () => {
    expect(isContractVerified({ contractVerifiedAt: "2026-10-10T00:00:00Z", contractVersion: CONTRACT_VERSION })).toBe(true);
    expect(isContractVerified({ contractVerifiedAt: "2026-10-10T00:00:00Z", contractVersion: "x" })).toBe(false);
    expect(isContractVerified({})).toBe(false);
    expect(isContractVerified(null)).toBe(false);
  });
});

describe("markContractVerified", () => {
  const fakeDb = () => {
    const calls: { upsert: unknown[]; audit: unknown[] } = { upsert: [], audit: [] };
    return {
      calls,
      db: {
        integrationConfig: {
          findUnique: vi.fn(async () => ({ settings: { keep: "me" } })),
          update: vi.fn(async (a: unknown) => { calls.upsert.push(a); }),
        },
        auditLog: { create: vi.fn(async (a: unknown) => { calls.audit.push(a); }) },
      },
    };
  };
  const now = new Date("2026-10-12T10:00:00Z");

  it("stores the date and current version, keeps other settings, and writes an audit row", async () => {
    const { db, calls } = fakeDb();
    await markContractVerified(db as never, { confirm: true }, { userId: "u1", now });
    expect(calls.upsert[0]).toMatchObject({ where: { provider: "referral_api" }, data: { settings: { keep: "me", contractVerifiedAt: now.toISOString(), contractVersion: CONTRACT_VERSION } } });
    expect(calls.audit[0]).toMatchObject({ data: { userId: "u1", entity: "IntegrationConfig", entityId: "referral_api", action: "partner_contract_verified" } });
  });
  it("rejects input that is not an explicit confirmation", async () => {
    const { db, calls } = fakeDb();
    for (const bad of [{}, { confirm: false }, { confirm: "yes" }, null, undefined]) {
      await expect(markContractVerified(db as never, bad, { userId: "u1", now })).rejects.toThrow();
    }
    expect(calls.upsert).toHaveLength(0);
    expect(calls.audit).toHaveLength(0);
  });
  it("refuses when there is no integration row yet", async () => {
    const { db } = fakeDb();
    db.integrationConfig.findUnique.mockResolvedValueOnce(null as never);
    await expect(markContractVerified(db as never, { confirm: true }, { userId: "u1", now })).rejects.toThrow(/not set up/i);
  });
});
