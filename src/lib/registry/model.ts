/**
 * Product and Eligibility Registry: the shapes and vocabularies. Pure, no I/O.
 *
 * The registry is the only place a product fact may come from. Agents, the campaign planner and the copy tools cite a registry
 * id through `cite()` (cite.ts) and never state a product fact from model memory. Every value below is data an Admin enters;
 * the seed holds only generic EXAMPLE products that the owner must replace.
 */

/** Product level status. DRAFT: never approved. APPROVED: an approved version is in force. SUSPENDED: paused at once, not citable. RETIRED: closed for good, not citable. */
export const PRODUCT_STATUSES = ["DRAFT", "APPROVED", "SUSPENDED", "RETIRED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Version level state: the draft, review, approved flow. SUPERSEDED: a newer version was approved. */
export const VERSION_STATES = ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "SUPERSEDED"] as const;
export type VersionState = (typeof VERSION_STATES)[number];

export const AVAILABILITY = ["OPEN", "LIMITED", "CLOSED", "BY_REQUEST"] as const;
export type Availability = (typeof AVAILABILITY)[number];

/** Generic risk bands. The owner's real risk taxonomy replaces these labels, not the mechanism. */
export const RISK_CATEGORIES = ["LOW", "MODERATE", "MODERATELY_HIGH", "HIGH", "VERY_HIGH"] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const PRODUCT_CATEGORIES = ["EQUITY", "MUTUAL_FUND", "PMS", "INSURANCE", "BOND", "FIXED_DEPOSIT", "NPS", "AIF", "OTHER"] as const;
export type RegistryCategory = (typeof PRODUCT_CATEGORIES)[number];

export const ELIGIBILITY_KINDS = ["investor_type", "residency", "min_net_worth", "min_age", "kyc_complete", "other"] as const;
export type EligibilityKind = (typeof ELIGIBILITY_KINDS)[number];

export type EligibilityRule = { code: string; kind: EligibilityKind; value: string };
export type SalesRestriction = { code: string; text: string };
/** An approved marketing claim. Approval of the version approves its claims. `validUntil` (ISO) lets one claim lapse before the product does. */
export type MarketingClaim = { id: string; text: string; validUntil: string | null };

/** The editable content of one version. */
export type ProductContent = {
  name: string;
  category: RegistryCategory;
  summary: string | null;
  availability: Availability;
  /** Minor units (paise) of `currency`, or null when there is no minimum. */
  minInvestmentMinor: number | null;
  currency: string;
  riskCategory: RiskCategory;
  jurisdictions: string[];
  requiredDocuments: string[];
  eligibility: EligibilityRule[];
  salesRestrictions: SalesRestriction[];
  claims: MarketingClaim[];
  validFrom: Date | null;
  validTo: Date | null;
};

export type ProductHead = { id: string; key: string; isExample: boolean; status: ProductStatus; activeVersionId: string | null };
export type VersionRow = ProductContent & { id: string; versionNo: number; state: VersionState };

/** What the Prisma rows and the form hand to the validator: loose input, narrowed by `validateContent`. */
export type ContentInput = Partial<Record<keyof ProductContent, unknown>>;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null);

function toDate(v: unknown): Date | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

export type ValidationResult = { ok: true; content: ProductContent } | { ok: false; errors: string[] };

/** Strict validation of a version's content. Collects every error so a form can show them together. */
export function validateContent(input: ContentInput): ValidationResult {
  const errors: string[] = [];
  const name = str(input.name, 120);
  if (!name) errors.push("Name is required (up to 120 characters).");
  if (!isOneOf(PRODUCT_CATEGORIES, input.category)) errors.push("Category is not one of the known categories.");
  if (!isOneOf(AVAILABILITY, input.availability)) errors.push("Availability must be OPEN, LIMITED, CLOSED or BY_REQUEST.");
  if (!isOneOf(RISK_CATEGORIES, input.riskCategory)) errors.push("Risk category is not one of the known bands.");

  let minInvestmentMinor: number | null = null;
  if (input.minInvestmentMinor !== null && input.minInvestmentMinor !== undefined && input.minInvestmentMinor !== "") {
    const n = Number(input.minInvestmentMinor);
    if (!Number.isSafeInteger(n) || n < 0) errors.push("Minimum investment must be a whole number of minor units, zero or more.");
    else minInvestmentMinor = n;
  }
  const currency = typeof input.currency === "string" && /^[A-Z]{3}$/.test(input.currency) ? input.currency : null;
  if (!currency) errors.push("Currency must be a three letter code such as INR.");

  const list = (v: unknown, what: string, max: number): string[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.trim().length === 0 || x.length > max)) {
      errors.push(`${what} must be a list of short non-empty texts.`);
      return [];
    }
    return v.map((x: string) => x.trim());
  };
  const jurisdictions = list(input.jurisdictions, "Jurisdictions", 40);
  const requiredDocuments = list(input.requiredDocuments, "Required documents", 160);
  if (jurisdictions.length === 0) errors.push("At least one jurisdiction is required.");

  const eligibility: EligibilityRule[] = [];
  for (const r of Array.isArray(input.eligibility) ? input.eligibility : []) {
    const o = r as Partial<EligibilityRule>;
    if (!str(o.code, 60) || !isOneOf(ELIGIBILITY_KINDS, o.kind) || !str(o.value, 200)) errors.push("Each eligibility rule needs a code, a known kind and a value.");
    else eligibility.push({ code: o.code!.trim(), kind: o.kind, value: o.value!.trim() });
  }
  const salesRestrictions: SalesRestriction[] = [];
  for (const r of Array.isArray(input.salesRestrictions) ? input.salesRestrictions : []) {
    const o = r as Partial<SalesRestriction>;
    if (!str(o.code, 60) || !str(o.text, 400)) errors.push("Each sales restriction needs a code and a text.");
    else salesRestrictions.push({ code: o.code!.trim(), text: o.text!.trim() });
  }
  const claims: MarketingClaim[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(input.claims) ? input.claims : []) {
    const o = r as Partial<MarketingClaim>;
    const id = str(o.id, 60);
    const text = str(o.text, 400);
    const until = toDate(o.validUntil ?? null);
    if (!id || !text || until === "invalid") errors.push("Each marketing claim needs an id, a text and an optional valid-until date.");
    else if (seen.has(id)) errors.push(`Claim id "${id}" is used twice.`);
    else {
      seen.add(id);
      claims.push({ id, text, validUntil: until ? until.toISOString() : null });
    }
  }

  const validFrom = toDate(input.validFrom);
  const validTo = toDate(input.validTo);
  if (validFrom === "invalid" || validTo === "invalid") errors.push("Valid-from and valid-to must be dates.");
  else if (validFrom && validTo && validTo.getTime() <= validFrom.getTime()) errors.push("Valid-to must be after valid-from.");

  const summaryRaw = typeof input.summary === "string" ? input.summary.trim() : "";
  if (summaryRaw.length > 600) errors.push("Summary is limited to 600 characters.");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    content: {
      name: name!,
      category: input.category as RegistryCategory,
      summary: summaryRaw.length > 0 ? summaryRaw : null,
      availability: input.availability as Availability,
      minInvestmentMinor,
      currency: currency!,
      riskCategory: input.riskCategory as RiskCategory,
      jurisdictions,
      requiredDocuments,
      eligibility,
      salesRestrictions,
      claims,
      validFrom: validFrom as Date | null,
      validTo: validTo as Date | null,
    },
  };
}

export const EXAMPLE_LABEL = "EXAMPLE. Not a real product. The owner must replace this entry before anything is said to a customer.";

const ACRONYMS = new Set(["AIF", "PMS", "NPS", "KYC", "ISIN", "IN"]);
/** "MUTUAL_FUND" to "Mutual fund", keeping acronyms (AIF, PMS, NPS, KYC) in capitals. */
export function labelOf(code: string): string {
  const words = code.replace(/_/g, " ").toLowerCase().split(" ");
  return words.map((w, i) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}
