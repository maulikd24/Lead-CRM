import type { Prisma } from "@/generated/prisma/client";

import { EXAMPLE_LABEL, type ProductContent } from "./model";

/**
 * Generic, synthetic EXAMPLE products so the screens, the tests and the demo have something to show.
 * Nothing here is a real product, a real minimum, a real risk rating or an approved claim: every number and sentence is a placeholder,
 * every entry is flagged isExample, cite() refuses them in production, and the owner must replace them with the real catalogue.
 * The wording deliberately promises nothing: no returns, no outperformance, no guarantee.
 */

const base = (name: string, category: ProductContent["category"], risk: ProductContent["riskCategory"], over: Partial<ProductContent> = {}): ProductContent => ({
  name,
  category,
  summary: `${EXAMPLE_LABEL}`,
  availability: "OPEN",
  minInvestmentMinor: 100_000_00,
  currency: "INR",
  riskCategory: risk,
  jurisdictions: ["IN"],
  requiredDocuments: ["Example offer document (replace)", "Example risk disclosure (replace)"],
  eligibility: [
    { code: "example-investor-type", kind: "investor_type", value: "Example: the investor types this product is open to (replace)" },
    { code: "example-kyc", kind: "kyc_complete", value: "KYC complete" },
  ],
  salesRestrictions: [{ code: "example-restriction", text: "Example: a sales restriction the owner defines (replace)." }],
  claims: [{ id: "example-claim-1", text: "Example claim wording. Replace with a statement approved by Compliance.", validUntil: null }],
  validFrom: null,
  validTo: null,
  ...over,
});

export type ExampleSeed = { key: string; status: "APPROVED" | "DRAFT" | "SUSPENDED" | "RETIRED"; content: ProductContent; reason?: string };

export const EXAMPLE_PRODUCTS: ExampleSeed[] = [
  { key: "example-growth-fund", status: "APPROVED", content: base("Example Growth Fund (EXAMPLE)", "MUTUAL_FUND", "MODERATELY_HIGH") },
  { key: "example-income-portfolio", status: "APPROVED", content: base("Example Income Portfolio (EXAMPLE)", "PMS", "MODERATE", { minInvestmentMinor: 500_000_00, availability: "LIMITED" }) },
  { key: "example-alternative-scheme", status: "APPROVED", content: base("Example Alternative Scheme (EXAMPLE)", "AIF", "HIGH", { minInvestmentMinor: 1_000_000_00, availability: "BY_REQUEST", claims: [] }) },
  { key: "example-new-product", status: "DRAFT", content: base("Example Product Under Review (EXAMPLE)", "BOND", "LOW") },
  { key: "example-paused-product", status: "SUSPENDED", content: base("Example Paused Product (EXAMPLE)", "NPS", "MODERATE"), reason: "Example: paused while a disclosure is refreshed" },
  { key: "example-closed-product", status: "RETIRED", content: base("Example Closed Product (EXAMPLE)", "FIXED_DEPOSIT", "LOW", { availability: "CLOSED" }), reason: "Example: closed to new money" },
];

type SeedDb = {
  registryProduct: { findUnique: (a: { where: { key: string }; select: { id: true } }) => Promise<{ id: string } | null>; create: (a: { data: Prisma.RegistryProductUncheckedCreateInput }) => Promise<{ id: string }>; update: (a: { where: { id: string }; data: Prisma.RegistryProductUncheckedUpdateInput }) => Promise<unknown> };
  registryProductVersion: { create: (a: { data: Prisma.RegistryProductVersionUncheckedCreateInput }) => Promise<{ id: string }> };
};

/** Idempotent: an existing key is left exactly as it is (the owner may already have edited or replaced it). Returns the keys it created. */
export async function seedExampleProducts(db: SeedDb, now: Date = new Date()): Promise<string[]> {
  const created: string[] = [];
  for (const ex of EXAMPLE_PRODUCTS) {
    if (await db.registryProduct.findUnique({ where: { key: ex.key }, select: { id: true } })) continue;
    const p = await db.registryProduct.create({ data: { key: ex.key, isExample: true, status: "DRAFT", createdBy: "seed" } });
    const c = ex.content;
    const v = await db.registryProductVersion.create({
      data: {
        productId: p.id, versionNo: 1, state: ex.status === "DRAFT" ? "DRAFT" : "APPROVED", name: c.name, category: c.category, summary: c.summary, availability: c.availability,
        minInvestmentMinor: c.minInvestmentMinor === null ? null : BigInt(c.minInvestmentMinor), currency: c.currency, riskCategory: c.riskCategory, jurisdictions: c.jurisdictions,
        requiredDocuments: c.requiredDocuments, eligibility: c.eligibility as unknown as Prisma.InputJsonValue, salesRestrictions: c.salesRestrictions as unknown as Prisma.InputJsonValue,
        claims: c.claims as unknown as Prisma.InputJsonValue, validFrom: c.validFrom, validTo: c.validTo, createdBy: "seed",
        ...(ex.status === "DRAFT" ? {} : { reviewedBy: "seed", reviewedAt: now, reviewNote: "Seeded example. Not a real approval." }),
      },
    });
    if (ex.status !== "DRAFT") {
      await db.registryProduct.update({ where: { id: p.id }, data: { status: ex.status, activeVersionId: v.id, statusReason: ex.reason ?? null, statusChangedAt: now, statusChangedBy: "seed" } });
    }
    created.push(ex.key);
  }
  return created;
}
