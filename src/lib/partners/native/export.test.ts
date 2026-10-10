import { describe, expect, it, vi } from "vitest";

import { prepareStatementExport } from "./export";
import type { StatementData } from "./queries";

const data: StatementData = {
  partner: { id: "p1", code: "PTR-00001", name: "Asha Associates", type: "PARTNER", tier: "GOLD", status: "ACTIVE", bankLast4: "4321", bankVerifiedAt: "2026-08-01T00:00:00.000Z" },
  period: { kind: "run", start: "2026-08-31T18:30:00.000Z", end: "2026-09-30T18:30:00.000Z", key: "run1" },
  run: { id: "run1", status: "APPROVED" },
  payout: { id: "py1", status: "APPROVED", externalRef: null, reconciledAt: null, totalAccrual: "100", adjustment: "-10", net: "90" },
  lines: [{ id: "l1", date: "2026-09-05T05:00:00.000Z", revenueType: "BROKERAGE", clientCode: "CL-00001", amount: "100" }],
  adjustments: [{ id: "a1", date: "2026-09-20T05:00:00.000Z", reason: "Clawback", amount: "-10" }],
};
const actor = { userId: "u1", role: "FINANCE" as const };

function deps(over: Partial<Parameters<typeof prepareStatementExport>[0]> = {}) {
  const order: string[] = [];
  const audit = vi.fn(async () => void order.push("audit"));
  const loadStatement = vi.fn(async () => (order.push("load"), data as StatementData | null));
  return { d: { loadStatement, audit, now: () => new Date("2026-10-10T06:00:00Z"), ...over }, audit, loadStatement, order };
}

describe("prepareStatementExport", () => {
  it("builds the CSV and records who exported what, in that order: audit first", async () => {
    const { d, audit, order } = deps();
    const r = await prepareStatementExport(d, { ...actor, partnerId: "p1", run: "run1", format: "csv" });
    expect(r!.kind).toBe("ok");
    expect(order).toEqual(["load", "audit"]);
    expect(audit).toHaveBeenCalledWith({
      userId: "u1",
      entity: "PartnerProfile",
      entityId: "p1",
      action: "partner_statement_exported",
      newValue: { format: "csv", period: "run1", lines: 1, adjustments: 1, role: "FINANCE" },
    });
  });

  it("returns a safe filename and the CSV text", async () => {
    const { d } = deps();
    const r = await prepareStatementExport(d, { ...actor, partnerId: "p1", run: "run1", format: "csv" });
    if (r?.kind !== "ok") throw new Error("expected ok");
    expect(r.filename).toBe("statement-PTR-00001-run1.csv");
    expect(r.csv.startsWith("﻿")).toBe(true);
    expect(r.csv).toContain("Net before tax,");
    expect(r.csv).toContain("90.00");
  });

  it("writes an audit entry for the print version too, with its own format", async () => {
    const { d, audit } = deps();
    const r = await prepareStatementExport(d, { ...actor, partnerId: "p1", run: "run1", format: "print" });
    expect(r!.kind).toBe("ok");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ newValue: expect.objectContaining({ format: "print" }) }));
  });

  it("is not found, and writes no audit entry, when the statement is not visible to this person", async () => {
    const { d, audit } = deps({ loadStatement: vi.fn(async () => null) });
    expect(await prepareStatementExport(d, { ...actor, partnerId: "p9", run: "run1", format: "csv" })).toEqual({ kind: "not_found" });
    expect(audit).not.toHaveBeenCalled();
  });

  it("gives nothing away when the audit write fails: it throws and no file is produced", async () => {
    const { d } = deps({ audit: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(prepareStatementExport(d, { ...actor, partnerId: "p1", run: "run1", format: "csv" })).rejects.toThrow("db down");
  });

  it("never lets the bank account past the last four digits into the file or the audit entry", async () => {
    const { d, audit } = deps();
    const r = await prepareStatementExport(d, { ...actor, partnerId: "p1", run: "run1", format: "csv" });
    if (r?.kind !== "ok") throw new Error("expected ok");
    expect(r.csv).toContain("****4321");
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/4321|Asha|CL-0/);
  });

  it("describes the statement for the print page without recomputing it", async () => {
    const { d } = deps();
    const r = await prepareStatementExport(d, { ...actor, partnerId: "p1", run: "run1", format: "print" });
    if (r?.kind !== "ok") throw new Error("expected ok");
    expect(r.data.partner.code).toBe("PTR-00001");
    expect(r.generatedOn).toBe("10 Oct 2026, 11:30 IST");
  });
});
