import type { MarketingClaim, ProductHead, RiskCategory, VersionRow } from "./model";

/**
 * The citation guard. Every agent, the campaign planner and every copy tool that wants to mention a product MUST obtain it
 * here and may only use what comes back. The guard REFUSES, with a reason code, anything that is not an approved, in-date
 * registry product: unknown, never approved, suspended, retired, not yet valid, expired, or an unreplaced example in production.
 *
 * Order matters and is pinned by tests: status is judged before anything else, so a retired product can never be cited because
 * its version still says APPROVED. A refusal carries no product facts at all.
 */

export type CitationRefusalReason = "unknown_product" | "unapproved" | "suspended" | "retired" | "no_approved_version" | "not_yet_valid" | "expired" | "example_product";

export type CitableRecord = { product: ProductHead; version: VersionRow | null };

export type Citation = {
  ok: true;
  productId: string;
  key: string;
  versionId: string;
  versionNo: number;
  name: string;
  isExample: boolean;
  /** When the cited facts were read: facts are as of this moment (observed_at). */
  asOf: Date;
  facts: {
    category: string;
    availability: string;
    minInvestmentMinor: number | null;
    currency: string;
    riskCategory: RiskCategory;
    jurisdictions: string[];
    requiredDocuments: string[];
    eligibility: VersionRow["eligibility"];
    salesRestrictions: VersionRow["salesRestrictions"];
  };
  /** Only claims that are approved and not lapsed. Copy may use these ids and texts and nothing else. */
  claims: MarketingClaim[];
};
export type CitationRefusal = { ok: false; reason: CitationRefusalReason; productId: string };
export type CitationResult = Citation | CitationRefusal;

export type CiteOptions = { now: Date; allowExamples: boolean };

const refuse = (productId: string, reason: CitationRefusalReason): CitationRefusal => ({ ok: false, reason, productId });

export function citeFromRecords(record: CitableRecord | null, opts: CiteOptions, requestedId = ""): CitationResult {
  if (!record) return refuse(requestedId, "unknown_product");
  const { product, version } = record;
  // Status first. Never reorder: a retired or suspended product must be refused whatever its versions say.
  if (product.status === "RETIRED") return refuse(product.id, "retired");
  if (product.status === "SUSPENDED") return refuse(product.id, "suspended");
  if (product.status !== "APPROVED") return refuse(product.id, "unapproved");
  if (!version || version.state !== "APPROVED" || version.id !== product.activeVersionId) return refuse(product.id, "no_approved_version");
  const t = opts.now.getTime();
  if (version.validFrom && version.validFrom.getTime() > t) return refuse(product.id, "not_yet_valid");
  if (version.validTo && version.validTo.getTime() <= t) return refuse(product.id, "expired");
  if (product.isExample && !opts.allowExamples) return refuse(product.id, "example_product");
  return {
    ok: true,
    productId: product.id,
    key: product.key,
    versionId: version.id,
    versionNo: version.versionNo,
    name: version.name,
    isExample: product.isExample,
    asOf: opts.now,
    facts: {
      category: version.category,
      availability: version.availability,
      minInvestmentMinor: version.minInvestmentMinor,
      currency: version.currency,
      riskCategory: version.riskCategory,
      jurisdictions: [...version.jurisdictions],
      requiredDocuments: [...version.requiredDocuments],
      eligibility: version.eligibility.map((e) => ({ ...e })),
      salesRestrictions: version.salesRestrictions.map((s) => ({ ...s })),
    },
    claims: version.claims.filter((c) => !c.validUntil || new Date(c.validUntil).getTime() > t).map((c) => ({ ...c })),
  };
}

export class CitationRefusedError extends Error {
  constructor(readonly refusal: CitationRefusal) {
    super(`Registry citation refused (${refusal.reason}) for product ${refusal.productId || "(none)"}`);
    this.name = "CitationRefusedError";
  }
}

/** For callers that would rather throw than branch: returns the citation or throws CitationRefusedError. */
export function assertCitable(result: CitationResult): Citation {
  if (!result.ok) throw new CitationRefusedError(result);
  return result;
}
