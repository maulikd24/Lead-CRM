import { describe, expect, it, vi } from "vitest";

import { ingestPortfolioBatch, httpStatusFor, type IngestDeps } from "./ingest";
import { createMemoryRepo } from "./memory-repo";
import type { IdentityHits } from "./match";

const entry = (code: string) => ({
  customer: { clientCode: code },
  holdings: [{ accountNumber: `ACC-${code}`, productCode: "SYN-1", quantity: 1, currentValue: 10, asOfDate: "2026-10-08" }],
  transactions: [{ externalRef: `T-${code}`, accountNumber: `ACC-${code}`, type: "BUY", date: "2026-10-08T00:00:00Z", grossAmount: 10 }],
});

function deps(over: Partial<IngestDeps> = {}): IngestDeps & { repo: ReturnType<typeof createMemoryRepo> } {
  const repo = createMemoryRepo();
  const known: Record<string, string> = { "CL-1": "client-1", "CL-2": "client-2", "CL-DUP": "client-9" };
  return {
    lookup: async (identities) =>
      identities.map((i): IdentityHits => ({ clientCode: i.clientCode && known[i.clientCode] ? [known[i.clientCode]] : [], ...(i.pan === "ABCDE1234F" ? { pan: ["client-1", "client-2"] } : {}) })),
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

  it("reports an ambiguous customer and writes nothing for it", async () => {
    const d = deps();
    const r = await ingestPortfolioBatch(env([{ ...entry("CL-1"), customer: { clientCode: "CL-1", pan: "ABCDE1234F" } }]), d);
    expect(r.results[0]).toMatchObject({ status: "ambiguous" });
    expect(d.repo.state.positions.size).toBe(0);
  });

  it("reports an invalid entry and keeps the rest", async () => {
    const r = await ingestPortfolioBatch(env([entry("CL-1"), { customer: {} }, "nope"]), deps());
    expect(r.results.map((x) => x.status)).toEqual(["matched", "invalid", "invalid"]);
    expect(r.results[1]).toMatchObject({ code: "NO_IDENTIFIER" });
    expect(r.results[2]).toMatchObject({ code: "INVALID_ENTRY" });
  });

  it("surfaces row errors by position and code, and 207s", async () => {
    const bad = entry("CL-1");
    bad.holdings.push({ accountNumber: "A", productCode: "B", quantity: "x" as unknown as number, currentValue: 1, asOfDate: "2026-10-08" });
    const r = await ingestPortfolioBatch(env([bad]), deps());
    expect(r.results[0]).toMatchObject({ status: "matched", errors: [{ kind: "holding", index: 1, code: "INVALID_ROW" }] });
    expect(httpStatusFor(r)).toBe(207);
  });

  it("is replay-safe: the second delivery reports everything unchanged and 200", async () => {
    const d = deps();
    await ingestPortfolioBatch(env([entry("CL-1")]), d);
    const r = await ingestPortfolioBatch(env([entry("CL-1")]), d);
    expect(r.counts.holdings).toMatchObject({ created: 0, unchanged: 1 });
    expect(r.counts.transactions).toMatchObject({ created: 0, unchanged: 1 });
    expect(httpStatusFor(r)).toBe(200);
    expect(d.repo.state.positions.size).toBe(1);
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
