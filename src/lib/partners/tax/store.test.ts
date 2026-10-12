import { describe, expect, it, vi } from "vitest";

import { ApprovalBlockedError } from "@/lib/policy/approvals/service";
import { applyTaxRuleChange, checkTaxRuleChange, loadTaxRules, proposeTaxRuleChange, toTaxRule, type TaxStoreDb } from "./store";

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  kind: "TDS",
  label: "Section X",
  ratePercent: { toFixed: () => "10.0000" },
  thresholdAmount: { toFixed: () => "20000.00" },
  partnerTypes: [],
  panStatus: "ANY",
  gstRegistration: "ANY",
  gstMode: null,
  effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
  effectiveTo: null,
  ...over,
});

function fakeDb(rules: ReturnType<typeof row>[] = [], requestedById = "u-maker") {
  const created: Record<string, unknown>[] = [];
  const ended: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const db = {
    partnerTaxRule: {
      findMany: vi.fn(async () => rules),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "new1", ...data };
      }),
      update: vi.fn(async (a: Record<string, unknown>) => {
        ended.push(a);
        return {};
      }),
    },
    approvalRequest: { findUnique: vi.fn(async () => ({ requestedById })) },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => audits.push(data)) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db: db as unknown as TaxStoreDb, created, ended, audits };
}

const now = new Date("2026-10-10T06:00:00.000Z");
const create = { op: "create" as const, rule: { kind: "TDS", label: "Section X", ratePercent: "5", thresholdAmount: "1000", effectiveFrom: "2026-11-01" } };

describe("toTaxRule / loadTaxRules", () => {
  it("reads database rows into the exact string form the maths uses, trimming trailing zeros", () => {
    expect(toTaxRule(row())).toMatchObject({ id: "r1", ratePercent: "10", thresholdAmount: "20000", effectiveFrom: "2026-04-01T00:00:00.000Z", effectiveTo: null });
    expect(toTaxRule(row({ ratePercent: { toFixed: () => "3.7500" }, thresholdAmount: { toFixed: () => "100.50" } }))).toMatchObject({ ratePercent: "3.75", thresholdAmount: "100.5" });
    expect(toTaxRule(row({ thresholdAmount: null })).thresholdAmount).toBeNull();
  });
  it("loads every rule", async () => {
    const { db } = fakeDb([row(), row({ id: "r2" })]);
    expect((await loadTaxRules(db)).map((r) => r.id)).toEqual(["r1", "r2"]);
  });
});

describe("proposeTaxRuleChange", () => {
  it("files an approval request for a valid change and audits the proposal, without changing any rule", async () => {
    const { db, created, audits } = fakeDb();
    const request = vi.fn(async () => ({ id: "req1" }));
    const r = await proposeTaxRuleChange({ db, request }, { id: "u-maker", role: "FINANCE" }, create, now);
    expect(r).toEqual({ ok: true, requestId: "req1", summary: expect.stringContaining("Add tax rule") });
    expect(request).toHaveBeenCalledWith("PARTNER_TAX_RULE_CHANGE", expect.objectContaining({ entity: "PartnerTaxRule", payload: create }), { id: "u-maker", role: "FINANCE" });
    expect(created).toHaveLength(0);
    expect(audits).toEqual([expect.objectContaining({ userId: "u-maker", entity: "PartnerTaxRule", action: "partner_tax_rule_proposed" })]);
  });
  it("refuses an invalid change with the reasons and files nothing", async () => {
    const { db, audits } = fakeDb();
    const request = vi.fn();
    const r = await proposeTaxRuleChange({ db, request }, { id: "u", role: "FINANCE" }, { op: "create", rule: { kind: "TDS" } }, now);
    expect(r.ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(audits).toHaveLength(0);
  });
});

describe("applyTaxRuleChange (runs on approval)", () => {
  it("creates the rule with both people recorded, and audits it under the approver", async () => {
    const { db, created, audits } = fakeDb([], "u-maker");
    await applyTaxRuleChange(db, create, { approvalRequestId: "req1", decidedById: "u-checker" }, now);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kind: "TDS", ratePercent: "5", thresholdAmount: "1000", createdById: "u-maker", approvedById: "u-checker", approvalRequestId: "req1" });
    expect(audits).toEqual([expect.objectContaining({ userId: "u-checker", action: "partner_tax_rule_created", entityId: "new1" })]);
  });
  it("refuses when the author and the approver are the same person, even if called directly", async () => {
    const { db, created } = fakeDb([], "u-same");
    await expect(applyTaxRuleChange(db, create, { approvalRequestId: "req1", decidedById: "u-same" }, now)).rejects.toThrow(/different person/i);
    expect(created).toHaveLength(0);
  });
  it("replace ends the old rule and adds the new one in one go", async () => {
    const { db, created, ended, audits } = fakeDb([row()], "u-maker");
    await applyTaxRuleChange(db, { op: "replace", ruleId: "r1", rule: create.rule }, { approvalRequestId: "req1", decidedById: "u-checker" }, now);
    expect(ended).toEqual([expect.objectContaining({ where: { id: "r1" }, data: { effectiveTo: new Date("2026-10-31T18:30:00.000Z") } })]);
    expect(created).toHaveLength(1);
    expect(audits.map((a) => a.action)).toEqual(["partner_tax_rule_ended", "partner_tax_rule_created"]);
  });
  it("throws if the plan no longer holds (the rules changed since it was proposed)", async () => {
    const { db } = fakeDb([row({ effectiveFrom: new Date("2026-10-01T00:00:00.000Z") })], "u-maker");
    await expect(applyTaxRuleChange(db, create, { approvalRequestId: "req1", decidedById: "u-checker" }, now)).rejects.toThrow();
  });
});

describe("checkTaxRuleChange (the approval precheck)", () => {
  it("passes a change that still holds", async () => {
    const { db } = fakeDb();
    await expect(checkTaxRuleChange(db, create, now)).resolves.toBeUndefined();
  });
  it("blocks, leaving the request pending, when it no longer holds", async () => {
    const { db } = fakeDb([row({ effectiveFrom: new Date("2026-10-01T00:00:00.000Z") })]);
    await expect(checkTaxRuleChange(db, create, now)).rejects.toBeInstanceOf(ApprovalBlockedError);
  });
});
