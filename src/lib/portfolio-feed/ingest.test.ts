import { describe, expect, it, vi } from "vitest";

import { ingestPortfolioBatch, httpStatusFor, type IngestDeps } from "./ingest";
import { createMemoryRepo } from "./memory-repo";
import type { IdentityHits } from "./match";

const entry = (code: string) => ({
  customer: { clientCode: code },
  holdings: [{ accountNumber: `ACC-${code}`, productCode: "SYN-1", quantity: 1, currentValue: 10, asOfDate: "2026-10-08", revision: 1 }],
  transactions: [{ externalRef: `T-${code}`, accountNumber: `ACC-${code}`, type: "BUY", date: "2026-10-08T00:00:00Z", grossAmount: 10, revision: 1 }],
});

function deps(over: Partial<IngestDeps> = {}): IngestDeps & { repo: ReturnType<typeof createMemoryRepo> } {
  const repo = createMemoryRepo();
  const known: Record<string, string> = { "CL-1": "client-1", "CL-2": "client-2", "CL-DUP": "client-9" };
  return {
    // Like the real lookup: every id per identifier, never one winner. A shared mobile returns both customers.
    lookup: async (identities) =>
      identities.map((i): IdentityHits => ({
        ...(i.clientCode ? { clientCode: known[i.clientCode] ? [known[i.clientCode]] : [] } : {}),
        ...(i.pan ? { pan: i.pan === "ABCDE1234F" ? ["client-1", "client-2"] : [] } : {}),
        ...(i.phoneKey ? { phoneKey: i.phoneKey === "9000000001" ? ["client-1", "client-2"] : i.phoneKey === "9000000002" ? ["client-2"] : [] } : {}),
      })),
    audit: vi.fn(async () => {}),
    now: () => Date.parse("2026-10-09T00:00:00Z"),
    ...over,
    repo,
  };
}
const env = (customers: unknown[]) => ({ version: 1 as const, batchId: "batch-1", customers });

describe("ingestPortfolioBatch", () => {
  it("writes matched customers and summarises", async () => {
    const d = deps();
    const r = await ingestPortfolioBatch(env([entry("CL-1"), entry("CL-2")]), d);
    expect(r.counts.customers).toMatchObject({ received: 2, matched: 2, unmatched: 0 });
    expect(r.counts.holdings.created).toBe(2);
    expect(r.counts.transactions.created).toBe(2);
    expect(httpStatusFor(r)).toBe(200);
    expect(d.audit).toHaveBeenCalledTimes(1);
  });

  it("reports unmatched customers without creating anything for them", async () => {
    const d = deps();
    const r = await ingestPortfolioBatch(env([entry("CL-1"), entry("CL-404")]), d);
    expect(r.results[1]).toEqual({ index: 1, status: "unmatched" });
    expect(r.counts.customers).toMatchObject({ matched: 1, unmatched: 1 });
    expect(d.repo.state.accounts.has("ACC-CL-404")).toBe(false);
    expect(httpStatusFor(r)).toBe(207);
  });

  it("a mobile that two customers share never authorises a write (no strong id => unmatched)", async () => {
    const d = deps();
    const r = await ingestPortfolioBatch(env([{ ...entry("X"), customer: { mobile: "+91 90000 00001" } }]), d);
    expect(r.results[0]).toEqual({ index: 0, status: "unmatched", code: "NO_STRONG_ID" });
    expect(d.repo.state.accounts.size).toBe(0);
  });

  it("a strong id plus a mobile that belongs to a different customer is ambiguous and writes nothing", async () => {
    const d = deps();
    const r = await ingestPortfolioBatch(env([{ ...entry("CL-1"), customer: { clientCode: "CL-1", mobile: "9000000002" } }]), d);
    expect(r.results[0]).toEqual({ index: 0, status: "ambiguous" });
    expect(d.repo.state.accounts.size).toBe(0);
  });

  it("a mistyped clientCode with a matching mobile is unmatched, not rescued by the mobile", async () => {
    const d = deps();
    const r = await ingestPortfolioBatch(env([{ ...entry("CL-TYPO"), customer: { clientCode: "CL-TYPO", mobile: "9000000002" } }]), d);
    expect(r.results[0]).toEqual({ index: 0, status: "unmatched" });
    expect(d.repo.state.accounts.size).toBe(0);
  });

  it("a shared mobile that includes the strong customer still lets the write through", async () => {
    const r = await ingestPortfolioBatch(env([{ ...entry("CL-1"), customer: { clientCode: "CL-1", mobile: "9000000001" } }]), deps());
    expect(r.results[0]).toMatchObject({ status: "matched" });
  });

  it("reports an ambiguous customer and writes nothing for it", async () => {
    const d = deps();
    const r = await ingestPortfolioBatch(env([{ ...entry("CL-1"), customer: { clientCode: "CL-1", pan: "ABCDE1234F" } }]), d);
    expect(r.results[0]).toMatchObject({ status: "ambiguous" });
    expect(d.repo.state.positions.size).toBe(0);
  });

  it("reports an invalid entry and keeps the rest", async () => {
    const r = await ingestPortfolioBatch(env([entry("CL-1"), { customer: {} }, "nope"]), deps());
    expect(r.results.map((x) => x.status)).toEqual(["matched", "unmatched", "invalid"]);
    expect(r.results[1]).toMatchObject({ code: "NO_STRONG_ID" });
    expect(r.results[2]).toMatchObject({ code: "INVALID_ENTRY" });
  });

  it("surfaces row errors by position and code, and 207s", async () => {
    const bad = entry("CL-1");
    bad.holdings.push({ accountNumber: "A", productCode: "B", quantity: "x" as unknown as number, currentValue: 1, asOfDate: "2026-10-08", revision: 1 });
    const r = await ingestPortfolioBatch(env([bad]), deps());
    expect(r.results[0]).toMatchObject({ status: "matched", errors: [{ kind: "holding", index: 1, code: "INVALID_ROW" }] });
    expect(httpStatusFor(r)).toBe(207);
  });

  it("is replay-safe: the second delivery reports everything unchanged and 200", async () => {
    const d = deps();
    await ingestPortfolioBatch(env([entry("CL-1")]), d);
    const r = await ingestPortfolioBatch(env([entry("CL-1")]), d);
    expect(r.counts.holdings).toMatchObject({ created: 0, unchanged: 1, stale: 0 });
    expect(r.counts.transactions).toMatchObject({ created: 0, unchanged: 1 });
    expect(httpStatusFor(r)).toBe(200);
    expect(d.repo.state.positions.size).toBe(1);
  });

  it("a stale replay is reported as stale but is not an error (200)", async () => {
    const d = deps();
    const newer = entry("CL-1");
    newer.holdings[0].revision = 2;
    newer.holdings[0].currentValue = 99;
    await ingestPortfolioBatch(env([newer]), d);
    const r = await ingestPortfolioBatch(env([entry("CL-1")]), d);
    expect(r.counts.holdings.stale).toBe(1);
    expect(httpStatusFor(r)).toBe(200);
  });

  it("rejects duplicate keys within the batch as failed rows (207), never last-write-wins", async () => {
    const d = deps();
    const r = await ingestPortfolioBatch(env([entry("CL-1"), entry("CL-1")]), d);
    expect(r.counts.holdings.failed).toBe(2);
    expect(d.repo.state.positions.size).toBe(0);
    expect(httpStatusFor(r)).toBe(207);
  });

  it("never lets a lookup failure leak: it throws for the route to turn into a generic 500", async () => {
    const d = deps({ lookup: async () => { throw new Error("db password=hunter2"); } });
    await expect(ingestPortfolioBatch(env([entry("CL-1")]), d)).rejects.toThrow();
  });

  it("a failing audit write does not fail the batch", async () => {
    const d = deps({ audit: async () => { throw new Error("audit down"); } });
    await expect(ingestPortfolioBatch(env([entry("CL-1")]), d)).resolves.toMatchObject({ counts: { customers: { matched: 1 } } });
  });

  it("the summary contains no identifiers or personal data", async () => {
    const r = await ingestPortfolioBatch(env([entry("CL-1"), entry("CL-404")]), deps());
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/CL-1|CL-404|ACC-|client-1/);
  });
});
