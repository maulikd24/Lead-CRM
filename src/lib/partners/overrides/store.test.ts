import { describe, expect, it, vi } from "vitest";

import { applyOverrideRuleChange, checkOverrideRuleChange, loadOverrideRules, proposeOverrideRuleChange, toOverrideRule, type OverrideStoreDb } from "./store";

const row = (over: Record<string, unknown> = {}) => ({ id: "o1", level: 1, ratePercent: { toFixed: () => "5.0000" }, capPerAccrual: { toFixed: () => "500.00" }, effectiveFrom: new Date("2026-04-01T00:00:00.000Z"), effectiveTo: null, ...over });

function fakeDb(rules: ReturnType<typeof row>[] = [], requestedById = "u-maker") {
  const created: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const db = {
    partnerOverrideRule: {
      findMany: vi.fn(async () => rules),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "new1" };
      }),
      update: vi.fn(async () => ({})),
    },
    approvalRequest: { findUnique: vi.fn(async () => ({ requestedById })) },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => audits.push(data)) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db: db as unknown as OverrideStoreDb, created, audits };
}
const now = new Date("2026-10-10T06:00:00.000Z");
const create = { op: "create" as const, rule: { level: "2", ratePercent: "2", capPerAccrual: "", effectiveFrom: "2026-11-01" } };

describe("override rule store", () => {
  it("reads rows into the exact string form", () => {
    expect(toOverrideRule(row())).toEqual({ id: "o1", level: 1, ratePercent: "5", capPerAccrual: "500", effectiveFrom: "2026-04-01T00:00:00.000Z", effectiveTo: null });
    expect(toOverrideRule(row({ capPerAccrual: null })).capPerAccrual).toBeNull();
  });
  it("loads every rule", async () => {
    expect((await loadOverrideRules(fakeDb([row()]).db)).map((r) => r.id)).toEqual(["o1"]);
  });
  it("proposes through approval and audits; nothing is written until approved", async () => {
    const { db, created, audits } = fakeDb();
    const request = vi.fn(async () => ({ id: "req1" }));
    const r = await proposeOverrideRuleChange({ db, request }, { id: "u-maker", role: "FINANCE" }, create, now);
    expect(r.ok).toBe(true);
    expect(request).toHaveBeenCalledWith("PARTNER_OVERRIDE_RULE_CHANGE", expect.objectContaining({ entity: "PartnerOverrideRule", payload: create }), { id: "u-maker", role: "FINANCE" });
    expect(created).toHaveLength(0);
    expect(audits[0]).toMatchObject({ action: "partner_override_rule_proposed", userId: "u-maker" });
  });
  it("refuses an invalid proposal (no default rate) without filing anything", async () => {
    const { db } = fakeDb();
    const request = vi.fn();
    const r = await proposeOverrideRuleChange({ db, request }, { id: "u", role: "FINANCE" }, { op: "create", rule: { level: "1" } }, now);
    expect(r.ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it("applies on approval with both people recorded, cap stored as null when blank", async () => {
    const { db, created, audits } = fakeDb();
    await applyOverrideRuleChange(db, create, { approvalRequestId: "req1", decidedById: "u-checker" }, now);
    expect(created[0]).toMatchObject({ level: 2, ratePercent: "2", capPerAccrual: null, createdById: "u-maker", approvedById: "u-checker", approvalRequestId: "req1" });
    expect(audits[0]).toMatchObject({ action: "partner_override_rule_created", userId: "u-checker" });
  });
  it("refuses the same person as author and approver", async () => {
    const { db, created } = fakeDb([], "u-same");
    await expect(applyOverrideRuleChange(db, create, { approvalRequestId: "r", decidedById: "u-same" }, now)).rejects.toThrow(/different person/i);
    expect(created).toHaveLength(0);
  });
  it("the precheck blocks a change that no longer holds", async () => {
    const { db } = fakeDb([row({ level: 2, effectiveFrom: new Date("2026-10-01T00:00:00.000Z") })]);
    await expect(checkOverrideRuleChange(db, create, now)).rejects.toThrow();
  });
});
