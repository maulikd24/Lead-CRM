import { describe, expect, it, vi } from "vitest";

import { TRUST_ITEMS, TRUST_REVIEW_STATUS, trustStatementHash } from "./trust-config";
import { isTrustSignedOff, recordTrustSignoff, revokeTrustSignoff, type TrustRecord, type TrustSignoffDb } from "./trust-signoff";

const NOW = new Date("2026-10-12T09:00:00Z");
const admin = { id: "a1", role: "ADMIN" };
const mk = (current: TrustRecord | null = null) => {
  const audits: unknown[] = [];
  const db: TrustSignoffDb & { saved: TrustRecord[]; cleared: number; audits: unknown[] } = {
    saved: [],
    cleared: 0,
    audits,
    read: vi.fn(async () => current),
    save: vi.fn(async (r: TrustRecord) => void db.saved.push(r)),
    clear: vi.fn(async () => void db.cleared++),
    audit: vi.fn(async (e: unknown) => void audits.push(e)),
  };
  return db;
};
const input = { confirm: true, reviewerName: "A. Reviewer", reviewedOn: "2026-10-11" };

describe("the trust strip config", () => {
  it("is marked pending and is the only place the wording lives", () => {
    expect(TRUST_REVIEW_STATUS).toBe("compliance review: pending");
    expect(TRUST_ITEMS.length).toBe(4);
  });
  it("makes no regulatory, residency, certification or performance claim", () => {
    expect(JSON.stringify(TRUST_ITEMS)).not.toMatch(/sebi|rbi|gdpr|iso ?27|soc ?2|residen|india|certif|compliant|guarantee|secure|encrypt|return/i);
  });
  it("hashes the wording, so any edit changes the hash", () => {
    const h = trustStatementHash(TRUST_ITEMS);
    expect(h).toMatch(/^[0-9a-f]{16,}$/);
    expect(trustStatementHash([{ ...TRUST_ITEMS[0], body: TRUST_ITEMS[0].body + " " }, ...TRUST_ITEMS.slice(1)])).not.toBe(h);
  });
});

describe("isTrustSignedOff (the gate)", () => {
  const h = trustStatementHash(TRUST_ITEMS);
  it("is false with no record", () => expect(isTrustSignedOff(null, h)).toBe(false));
  it("is true only for a record of the CURRENT wording", () => {
    const rec: TrustRecord = { statementHash: h, reviewerName: "R", reviewedOn: "2026-10-11", recordedById: "a1", recordedAt: NOW.toISOString() };
    expect(isTrustSignedOff(rec, h)).toBe(true);
    expect(isTrustSignedOff({ ...rec, statementHash: "old" }, h)).toBe(false);
  });
  it("is false for a malformed or empty-reviewer record", () => {
    expect(isTrustSignedOff({ statementHash: h } as never, h)).toBe(false);
    expect(isTrustSignedOff({ statementHash: h, reviewerName: " ", reviewedOn: "2026-10-11" } as never, h)).toBe(false);
  });
});

describe("recordTrustSignoff", () => {
  it("is Admin only", async () => {
    const db = mk();
    for (const role of ["MANAGER", "RM", "MARKETING", ""]) expect((await recordTrustSignoff(db, { id: "u", role }, input, NOW)).ok).toBe(false);
    expect(db.save).not.toHaveBeenCalled();
  });
  it("needs the confirmation box, a reviewer name and a real date that is not in the future", async () => {
    const db = mk();
    expect((await recordTrustSignoff(db, admin, { ...input, confirm: false }, NOW)).ok).toBe(false);
    expect((await recordTrustSignoff(db, admin, { ...input, reviewerName: " " }, NOW)).ok).toBe(false);
    expect((await recordTrustSignoff(db, admin, { ...input, reviewedOn: "not a date" }, NOW)).ok).toBe(false);
    expect((await recordTrustSignoff(db, admin, { ...input, reviewedOn: "2026-12-01" }, NOW)).ok).toBe(false);
    expect(db.save).not.toHaveBeenCalled();
  });
  it("stores who, when and which wording, and writes one audit row", async () => {
    const db = mk();
    const r = await recordTrustSignoff(db, admin, input, NOW);
    expect(r).toEqual({ ok: true, changed: true });
    expect(db.saved[0]).toMatchObject({ statementHash: trustStatementHash(TRUST_ITEMS), reviewerName: "A. Reviewer", reviewedOn: "2026-10-11", recordedById: "a1" });
    expect(db.audits).toEqual([expect.objectContaining({ userId: "a1", action: "trust_strip_signoff_recorded" })]);
  });
  it("does nothing and writes no audit row when this wording is already signed off", async () => {
    const db = mk({ statementHash: trustStatementHash(TRUST_ITEMS), reviewerName: "R", reviewedOn: "2026-10-11", recordedById: "a1", recordedAt: NOW.toISOString() });
    expect(await recordTrustSignoff(db, admin, input, NOW)).toEqual({ ok: true, changed: false });
    expect(db.audit).not.toHaveBeenCalled();
  });
});

describe("revokeTrustSignoff", () => {
  it("is Admin only, clears the record and audits", async () => {
    const rec: TrustRecord = { statementHash: "x", reviewerName: "R", reviewedOn: "2026-10-11", recordedById: "a1", recordedAt: NOW.toISOString() };
    const db = mk(rec);
    expect((await revokeTrustSignoff(db, { id: "u", role: "RM" })).ok).toBe(false);
    expect(await revokeTrustSignoff(db, admin)).toEqual({ ok: true, changed: true });
    expect(db.cleared).toBe(1);
    expect(db.audits).toEqual([expect.objectContaining({ action: "trust_strip_signoff_revoked" })]);
    expect(await revokeTrustSignoff(mk(null), admin)).toEqual({ ok: true, changed: false });
  });
});
