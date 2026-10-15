import { describe, expect, it } from "vitest";

import { citeFromRecords, type CitableRecord } from "./cite";

const NOW = new Date("2027-05-10T10:00:00Z");
const day = 86_400_000;

function rec(over: Partial<CitableRecord> = {}): CitableRecord {
  return {
    product: { id: "p1", key: "example-fund-a", isExample: false, status: "APPROVED", activeVersionId: "v1" },
    version: {
      id: "v1", versionNo: 2, state: "APPROVED", name: "Example Fund A", summary: null, category: "AIF", availability: "OPEN", minInvestmentMinor: 100_000_000, currency: "INR",
      riskCategory: "HIGH", jurisdictions: ["IN"], requiredDocuments: ["PPM"], eligibility: [], salesRestrictions: [],
      claims: [{ id: "c1", text: "Example claim one", validUntil: null }, { id: "c2", text: "Lapsed claim", validUntil: new Date(NOW.getTime() - day).toISOString() }],
      validFrom: new Date(NOW.getTime() - 10 * day), validTo: null,
    },
    ...over,
  };
}

describe("cite(): the citation guard", () => {
  it("cites an approved, in-date product and returns only its approved facts and unexpired claims", () => {
    const r = citeFromRecords(rec(), { now: NOW, allowExamples: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.productId).toBe("p1");
    expect(r.versionNo).toBe(2);
    expect(r.claims.map((c) => c.id)).toEqual(["c1"]); // the lapsed claim is not citable
    expect(r.facts.minInvestmentMinor).toBe(100_000_000);
  });

  it("refuses an unknown product", () => {
    expect(citeFromRecords(null, { now: NOW, allowExamples: true })).toMatchObject({ ok: false, reason: "unknown_product" });
  });

  it.each([
    ["SUSPENDED", "suspended"],
    ["RETIRED", "retired"],
    ["DRAFT", "unapproved"],
  ] as const)("refuses a %s product with reason %s", (status, reason) => {
    const r = citeFromRecords(rec({ product: { id: "p1", key: "k", isExample: false, status, activeVersionId: "v1" } }), { now: NOW, allowExamples: true });
    expect(r).toMatchObject({ ok: false, reason });
  });

  it("refuses an approved product that has no approved active version (an unapproved draft is never citable)", () => {
    expect(citeFromRecords(rec({ product: { id: "p1", key: "k", isExample: false, status: "APPROVED", activeVersionId: null }, version: null }), { now: NOW, allowExamples: true })).toMatchObject({ ok: false, reason: "no_approved_version" });
    const draft = rec();
    draft.version = { ...draft.version!, state: "IN_REVIEW" };
    expect(citeFromRecords(draft, { now: NOW, allowExamples: true })).toMatchObject({ ok: false, reason: "no_approved_version" });
  });

  it("refuses before valid-from and after valid-to", () => {
    const early = rec();
    early.version = { ...early.version!, validFrom: new Date(NOW.getTime() + day) };
    expect(citeFromRecords(early, { now: NOW, allowExamples: true })).toMatchObject({ ok: false, reason: "not_yet_valid" });
    const late = rec();
    late.version = { ...late.version!, validTo: new Date(NOW.getTime() - day) };
    expect(citeFromRecords(late, { now: NOW, allowExamples: true })).toMatchObject({ ok: false, reason: "expired" });
  });

  it("refuses an example product when examples are not allowed (production), and labels it when they are", () => {
    const ex = rec({ product: { id: "p1", key: "example-fund-a", isExample: true, status: "APPROVED", activeVersionId: "v1" } });
    expect(citeFromRecords(ex, { now: NOW, allowExamples: false })).toMatchObject({ ok: false, reason: "example_product" });
    const ok = citeFromRecords(ex, { now: NOW, allowExamples: true });
    expect(ok.ok && ok.isExample).toBe(true);
  });

  it("checks status BEFORE anything else: a retired product that is also an example is refused as retired", () => {
    const r = citeFromRecords(rec({ product: { id: "p1", key: "k", isExample: true, status: "RETIRED", activeVersionId: "v1" } }), { now: NOW, allowExamples: false });
    expect(r).toMatchObject({ ok: false, reason: "retired" });
  });
});
