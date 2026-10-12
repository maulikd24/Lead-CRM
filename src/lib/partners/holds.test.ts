import { describe, expect, it, vi } from "vitest";

import { checkPayoutRunHolds, evaluateHolds, findPayoutHolds, type HoldDb } from "./holds";

const p = (over: Record<string, unknown> = {}) => ({ partnerId: "p1", code: "PTR-00001", name: "Asha Associates", status: "ACTIVE", bankVerified: true, net: "100", ...over });

describe("findPayoutHolds: what stops a payout run being approved", () => {
  it("is empty when every partner is active with a verified bank", () => {
    expect(findPayoutHolds([p(), p({ partnerId: "p2", code: "PTR-00002" })])).toEqual([]);
  });
  it("blocks a suspended or terminated partner, and an unverified bank", () => {
    const holds = findPayoutHolds([p({ status: "SUSPENDED" }), p({ partnerId: "p2", code: "PTR-2", status: "TERMINATED" }), p({ partnerId: "p3", code: "PTR-3", bankVerified: false })]);
    expect(holds.map((h) => [h.code, h.reasons])).toEqual([
      ["PTR-00001", ["Partner is suspended"]],
      ["PTR-2", ["Partner is terminated"]],
      ["PTR-3", ["Bank account is not verified"]],
    ]);
  });
  it("lists both reasons for one partner", () => {
    expect(findPayoutHolds([p({ status: "SUSPENDED", bankVerified: false })])[0].reasons).toEqual(["Partner is suspended", "Bank account is not verified"]);
  });
  it("an onboarding partner is not blocked for their status alone", () => {
    expect(findPayoutHolds([p({ status: "ONBOARDING" })])).toEqual([]);
  });
  it("a payout of nothing needs no bank and is never held", () => {
    expect(findPayoutHolds([p({ status: "SUSPENDED", bankVerified: false, net: "0" })])).toEqual([]);
    expect(findPayoutHolds([p({ bankVerified: false, net: "0.00" })])).toEqual([]);
  });
  it("a clawback (negative net) with an unverified bank is still held: money is owed either way", () => {
    expect(findPayoutHolds([p({ bankVerified: false, net: "-50" })])).toHaveLength(1);
  });
});

describe("evaluateHolds: block, unless an Admin overrides with a typed reason", () => {
  const holds = findPayoutHolds([p({ status: "SUSPENDED" })]);
  it("allows a run with no holds, with no override needed", () => {
    expect(evaluateHolds({ holds: [], role: "ADMIN" })).toEqual({ allow: true, overridden: false });
  });
  it("blocks a run with holds when there is no override reason", () => {
    const r = evaluateHolds({ holds, role: "ADMIN" });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reasons).toEqual(["PTR-00001: Partner is suspended"]);
  });
  it("accepts an Admin's typed reason of at least ten characters", () => {
    expect(evaluateHolds({ holds, role: "ADMIN", overrideReason: "  Bank confirmed by phone call on 9 Oct  " })).toEqual({ allow: true, overridden: true, reason: "Bank confirmed by phone call on 9 Oct" });
  });
  it("a short or blank reason is not enough", () => {
    for (const reason of ["", "   ", "ok", "too short"]) expect(evaluateHolds({ holds, role: "ADMIN", overrideReason: reason }).allow, reason).toBe(false);
  });
  it("only an Admin may override: Finance cannot, however good the reason", () => {
    const r = evaluateHolds({ holds, role: "FINANCE", overrideReason: "Bank confirmed by phone call" });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reasons.join(" ")).toMatch(/only an administrator/i);
  });
  it("a reason that is too long is refused", () => {
    expect(evaluateHolds({ holds, role: "ADMIN", overrideReason: "x".repeat(501) }).allow).toBe(false);
  });
});

describe("checkPayoutRunHolds: the approval precheck", () => {
  const dec = (net: string) => ({ toFixed: () => net });
  const mk = (rows: unknown[]) => {
    const audits: Record<string, unknown>[] = [];
    const db = { payout: { findMany: vi.fn(async () => rows) }, auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => audits.push(data)) } } as unknown as HoldDb;
    return { db, audits };
  };
  const clean = [{ netPayableAmount: dec("100"), partnerProfile: { id: "p1", partnerCode: "PTR-1", empanelmentStatus: "ACTIVE", bankVerifiedAt: new Date(), user: { name: "A" } } }];
  const held = [{ netPayableAmount: dec("100"), partnerProfile: { id: "p2", partnerCode: "PTR-2", empanelmentStatus: "SUSPENDED", bankVerifiedAt: null, user: { name: "B" } } }];

  it("lets a clean run through without any audit row", async () => {
    const { db, audits } = mk(clean);
    await expect(checkPayoutRunHolds(db, "run1", { actor: { id: "u", role: "ADMIN" } })).resolves.toBeUndefined();
    expect(audits).toHaveLength(0);
  });
  it("blocks a held run with every reason, leaving no audit row", async () => {
    const { db, audits } = mk(held);
    await expect(checkPayoutRunHolds(db, "run1", { actor: { id: "u", role: "ADMIN" } })).rejects.toMatchObject({ name: "ApprovalBlockedError", reasons: ["PTR-2: Partner is suspended", "PTR-2: Bank account is not verified"] });
    expect(audits).toHaveLength(0);
  });
  it("lets an Admin override with a reason, and audits the override with the reason and the partners it covered", async () => {
    const { db, audits } = mk(held);
    await checkPayoutRunHolds(db, "run1", { actor: { id: "u-admin", role: "ADMIN" }, options: { holdOverrideReason: "Bank confirmed by phone call" } });
    expect(audits).toEqual([expect.objectContaining({ userId: "u-admin", entity: "PayoutRun", entityId: "run1", action: "payout_run_hold_overridden", reason: "Bank confirmed by phone call", newValue: { holds: [{ code: "PTR-2", reasons: ["Partner is suspended", "Bank account is not verified"] }] } })]);
  });
  it("Finance cannot override", async () => {
    const { db, audits } = mk(held);
    await expect(checkPayoutRunHolds(db, "run1", { actor: { id: "u", role: "FINANCE" }, options: { holdOverrideReason: "Bank confirmed by phone call" } })).rejects.toThrow();
    expect(audits).toHaveLength(0);
  });
});
