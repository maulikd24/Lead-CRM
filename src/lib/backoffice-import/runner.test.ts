import { describe, expect, it } from "vitest";

import { DEFAULT_MAPPING } from "./mapping";
import { runImport } from "./runner";
import { createDeps } from "./testkit";

const H = "clientCode,accountNumber,productCode,quantity,asOfDate\n";
const base = { fileName: "holdings.csv", trigger: "UPLOAD" as const, userId: "u1" };

describe("runImport: holdings", () => {
  it("applies a file, records a run and one audit entry", async () => {
    const t = createDeps();
    const r = await runImport({ ...base, kind: "HOLDINGS", text: `${H}CL-1,A1,P1,10,2026-10-01\nCL-2,A2,P1,5,2026-10-01`, dryRun: false }, DEFAULT_MAPPING, t.deps);
    expect(r.status).toBe("SUCCESS");
    expect(r.counts.holdings).toMatchObject({ created: 2, failed: 0 });
    expect(t.feedRepo.state.positions.size).toBe(2);
    expect(t.runs.rows).toHaveLength(1);
    expect(t.runs.rows[0]).toMatchObject({ status: "SUCCESS", dryRun: false, kind: "HOLDINGS" });
    expect(t.audits).toHaveLength(1);
  });

  it("re-running the identical file is skipped by checksum and writes nothing", async () => {
    const t = createDeps();
    const input = { ...base, kind: "HOLDINGS" as const, text: `${H}CL-1,A1,P1,10,2026-10-01`, dryRun: false };
    await runImport(input, DEFAULT_MAPPING, t.deps);
    const writes = t.feedRepo.state.writes;
    const again = await runImport(input, DEFAULT_MAPPING, t.deps);
    expect(again.status).toBe("SKIPPED_DUPLICATE");
    expect(t.feedRepo.state.writes).toBe(writes);
    expect(t.runs.rows).toHaveLength(1);
    expect(t.audits).toHaveLength(1);
  });

  it("force re-applies an identical file and the rows come back unchanged (revision per row)", async () => {
    const t = createDeps();
    const input = { ...base, kind: "HOLDINGS" as const, text: `${H}CL-1,A1,P1,10,2026-10-01`, dryRun: false };
    await runImport(input, DEFAULT_MAPPING, t.deps);
    const again = await runImport({ ...input, force: true }, DEFAULT_MAPPING, t.deps);
    expect(again.counts.holdings).toMatchObject({ created: 0, unchanged: 1 });
  });

  it("a corrected file (new checksum) gets a newer revision and updates the row", async () => {
    const t = createDeps();
    await runImport({ ...base, kind: "HOLDINGS", text: `${H}CL-1,A1,P1,10,2026-10-01`, dryRun: false }, DEFAULT_MAPPING, t.deps);
    const r = await runImport({ ...base, kind: "HOLDINGS", text: `${H}CL-1,A1,P1,12,2026-10-01`, dryRun: false }, DEFAULT_MAPPING, t.deps);
    expect(r.counts.holdings).toMatchObject({ updated: 1 });
    expect([...t.feedRepo.state.positions.values()][0].quantity).toBe("12");
  });

  it("dry run reports what would change but writes nothing, records a dry run and no duplicate lock", async () => {
    const t = createDeps();
    const input = { ...base, kind: "HOLDINGS" as const, text: `${H}CL-1,A1,P1,10,2026-10-01\nCL-9,A9,P1,1,2026-10-01`, dryRun: true };
    const r = await runImport(input, DEFAULT_MAPPING, t.deps);
    expect(r.dryRun).toBe(true);
    expect(r.counts.holdings).toMatchObject({ created: 1 });
    expect(t.feedRepo.state.writes).toBe(0);
    expect(t.feedRepo.state.accounts.size).toBe(0);
    expect(t.runs.rows[0]).toMatchObject({ dryRun: true });
    const real = await runImport({ ...input, dryRun: false }, DEFAULT_MAPPING, t.deps);
    expect(real.status).toBe("PARTIAL");
    expect(real.counts.holdings?.created).toBe(1);
  });

  it("dry-run counts equal the real run's counts", async () => {
    const text = `${H}CL-1,A1,P1,10,2026-10-01\nCL-2,A2,P2,3,2026-10-01\nCL-2,A2,P3,0,2026-10-01`;
    const dry = await runImport({ ...base, kind: "HOLDINGS", text, dryRun: true }, DEFAULT_MAPPING, createDeps().deps);
    const real = await runImport({ ...base, kind: "HOLDINGS", text, dryRun: false }, DEFAULT_MAPPING, createDeps().deps);
    expect(dry.counts).toEqual(real.counts);
  });

  it("builds a per-row error report by line: unmatched customer, invalid value; PARTIAL status", async () => {
    const t = createDeps();
    const r = await runImport({ ...base, kind: "HOLDINGS", text: `${H}CL-1,A1,P1,10,2026-10-01\nCL-404,A4,P1,1,2026-10-01\nCL-1,A1,P2,abc,2026-10-01\n,A5,P1,1,2026-10-01`, dryRun: false }, DEFAULT_MAPPING, t.deps);
    expect(r.status).toBe("PARTIAL");
    expect(r.errors).toEqual(
      expect.arrayContaining([
        { line: 3, code: "CUSTOMER_UNMATCHED", fields: [] },
        { line: 4, code: "INVALID_ROW", fields: ["quantity"] },
        { line: 5, code: "NO_STRONG_ID", fields: [] },
      ]),
    );
    expect(r.counts.holdings?.created).toBe(1);
    expect(JSON.stringify(r.errors)).not.toContain("CL-404");
  });

  it("a writer-level failure (account owned by another customer) is reported against its line", async () => {
    const t = createDeps();
    await runImport({ ...base, kind: "HOLDINGS", text: `${H}CL-1,A1,P1,10,2026-10-01`, dryRun: false }, DEFAULT_MAPPING, t.deps);
    const r = await runImport({ ...base, kind: "HOLDINGS", text: `${H}CL-2,A1,P1,1,2026-10-02`, dryRun: false }, DEFAULT_MAPPING, t.deps);
    expect(r.errors).toEqual([{ line: 2, code: "ACCOUNT_OWNED_BY_OTHER_CUSTOMER", fields: [] }]);
  });

  it("a file-level failure is FAILED with a code, never the content", async () => {
    const t = createDeps();
    const missing = await runImport({ ...base, kind: "HOLDINGS", text: "clientCode,accountNumber\nCL-1,A1", dryRun: false }, DEFAULT_MAPPING, t.deps);
    expect(missing).toMatchObject({ status: "FAILED", failureCode: "MISSING_COLUMN", missingFields: ["productCode", "quantity", "asOfDate"] });
    const empty = await runImport({ ...base, kind: "HOLDINGS", text: "", dryRun: false }, DEFAULT_MAPPING, t.deps);
    expect(empty).toMatchObject({ status: "FAILED", failureCode: "EMPTY" });
    expect(t.runs.rows.map((x) => x.status)).toEqual(["FAILED", "FAILED"]);
    expect(t.audits).toHaveLength(2);
  });

  it("a thrown infrastructure error marks the run FAILED and does not leak the message", async () => {
    const t = createDeps();
    t.deps.lookup = async () => {
      throw new Error("db down for CL-1");
    };
    const r = await runImport({ ...base, kind: "HOLDINGS", text: `${H}CL-1,A1,P1,10,2026-10-01`, dryRun: false }, DEFAULT_MAPPING, t.deps);
    expect(r).toMatchObject({ status: "FAILED", failureCode: "INTERNAL_ERROR" });
    expect(JSON.stringify(r)).not.toContain("CL-1");
    expect(t.runs.rows[0].status).toBe("FAILED");
  });

  it("an identical run already in progress is skipped", async () => {
    const t = createDeps();
    const input = { ...base, kind: "HOLDINGS" as const, text: `${H}CL-1,A1,P1,10,2026-10-01`, dryRun: false };
    await t.deps.runs.start({ kind: "HOLDINGS", fileName: "x.csv", checksum: (await runImport({ ...input, dryRun: true }, DEFAULT_MAPPING, t.deps)).checksum, dryRun: false, trigger: "CRON", userId: null });
    const r = await runImport(input, DEFAULT_MAPPING, t.deps);
    expect(r).toMatchObject({ status: "SKIPPED_DUPLICATE", reason: "in_progress" });
  });

  it("caps stored errors but keeps exact counts", async () => {
    const t = createDeps();
    const rows = Array.from({ length: 300 }, (_, i) => `CL-X${i},A${i},P1,1,2026-10-01`).join("\n");
    const r = await runImport({ ...base, kind: "HOLDINGS", text: H + rows, dryRun: true }, DEFAULT_MAPPING, t.deps);
    expect(r.errors).toHaveLength(200);
    expect(r.errorsTruncated).toBe(true);
    expect(r.counts.customers).toMatchObject({ unmatched: 300 });
  });
});

describe("runImport: transactions", () => {
  it("imports transactions through the feed writer", async () => {
    const t = createDeps();
    const text = "clientCode,externalRef,accountNumber,productCode,type,date,grossAmount\nCL-1,T1,A1,P1,BUY,2026-10-01,100\nCL-1,T2,A1,P1,SELL,2026-10-02,-50";
    const r = await runImport({ ...base, kind: "TRANSACTIONS", text, dryRun: false }, DEFAULT_MAPPING, t.deps);
    expect(r.counts.transactions).toMatchObject({ created: 2 });
    expect(t.feedRepo.state.transactions.size).toBe(2);
  });
});

describe("runImport: client master", () => {
  const C = "clientCode,pan,name,city,email\n";
  it("fills blanks on matched clients and never creates clients", async () => {
    const t = createDeps({ "CL-1": { name: "Asha", city: null, pan: "ABCDE1234F" } });
    const r = await runImport({ ...base, kind: "CLIENTS", text: `${C}CL-1,,Asha Rao,Pune,a@example.com\nCL-404,,Ghost,X,`, dryRun: false }, DEFAULT_MAPPING, t.deps);
    expect(t.clients.updates).toEqual([{ id: "id-CL-1", data: { city: "Pune", email: "a@example.com" } }]);
    expect(r.counts.clients).toMatchObject({ received: 2, matched: 1, updated: 1, unmatched: 1 });
    expect(r.counts.clients?.fieldsChanged).toEqual({ city: 1, email: 1 });
    expect(r.status).toBe("PARTIAL");
    expect(t.clients.clients.size).toBe(1);
  });
  it("overwrite policy replaces name but never an existing email or mobile", async () => {
    const t = createDeps({ "CL-1": { name: "Old", email: "keep@example.com" } });
    await runImport({ ...base, kind: "CLIENTS", text: `${C}CL-1,,New Name,,new@example.com`, dryRun: false }, { ...DEFAULT_MAPPING, updatePolicy: "overwrite" }, t.deps);
    expect(t.clients.updates[0].data).toEqual({ name: "New Name" });
  });
  it("matches by PAN and reports an identical row as unchanged", async () => {
    const t = createDeps({ "CL-1": { name: "Asha Rao", pan: "ABCDE1234F" } });
    const r = await runImport({ ...base, kind: "CLIENTS", text: `${C},abcde1234f,Asha Rao,,`, dryRun: false }, DEFAULT_MAPPING, t.deps);
    expect(r.counts.clients).toMatchObject({ matched: 1, unchanged: 1, updated: 0 });
  });
  it("refuses a client that appears on two lines and invalid values, by line", async () => {
    const t = createDeps({ "CL-1": { name: "Asha" } });
    const r = await runImport({ ...base, kind: "CLIENTS", text: `${C}CL-1,,A,,\nCL-1,,B,,\nCL-2,,Bala,,not-an-email`, dryRun: false }, DEFAULT_MAPPING, t.deps);
    expect(t.clients.updates).toEqual([]);
    expect(r.errors).toEqual(
      expect.arrayContaining([
        { line: 2, code: "DUPLICATE_KEY", fields: [] },
        { line: 3, code: "DUPLICATE_KEY", fields: [] },
        { line: 4, code: "INVALID_ROW", fields: ["email"] },
      ]),
    );
  });
  it("dry run changes nothing and equals the real counts", async () => {
    const text = `${C}CL-1,,Asha Rao,Pune,a@example.com`;
    const a = createDeps({ "CL-1": { name: "Asha" } });
    const dry = await runImport({ ...base, kind: "CLIENTS", text, dryRun: true }, DEFAULT_MAPPING, a.deps);
    expect(a.clients.updates).toEqual([]);
    const b = createDeps({ "CL-1": { name: "Asha" } });
    const real = await runImport({ ...base, kind: "CLIENTS", text, dryRun: false }, DEFAULT_MAPPING, b.deps);
    expect(dry.counts).toEqual(real.counts);
  });
});
