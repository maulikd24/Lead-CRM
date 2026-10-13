/**
 * Eligibility for a registry product, pure (no database, no clock of its own).
 *
 * A product may be recommended to a client only when every eligibility rule in force on the given date passes for that
 * client. The check fails closed: a product that is not APPROVED, a product with no rule in force, a predicate that does
 * not parse, a field that is unknown or missing for the client, or an unknown investable amount all mean "not eligible",
 * with a plain reason. Rules are JSON predicate trees (see `Predicate`); they are stored in the EligibilityRule table.
 */

export type ClientField = "kyc.status" | "kyc.complete" | "risk.profile" | "risk.score" | "client.category" | "client.jurisdiction";

export type Predicate =
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | { field: ClientField; op: "eq" | "neq" | "in" | "gte" | "lte"; value: string | number | boolean | string[] };

/** The client facts an eligibility rule may read. Built by the caller from KYC and the risk profile. */
export interface EligibilityClient {
  kycStatus: string;
  kycComplete: boolean;
  riskProfile: string;
  riskScore: number | null;
  category: string;
  jurisdiction: string;
  /** Investable amount in minor units. Undefined means the check is not made; null means unknown (fails closed when the product has a minimum). */
  investableMinor?: bigint | number | null;
}

export interface EligibilityRuleRow {
  productKey: string;
  label: string;
  predicate: unknown;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface EligibilityProduct {
  key: string;
  /** The registry status of the product. Only APPROVED passes. */
  status: "DRAFT" | "APPROVED" | "SUSPENDED" | "RETIRED" | string;
  minInvestmentMinor: bigint | number | null;
  riskCategory: string;
  rules: EligibilityRuleRow[];
}

export interface EligibilityResult {
  eligible: boolean;
  /** Plain sentences. Empty when eligible. */
  reasons: string[];
  /** Labels of the rules that were in force and passed. */
  rulesPassed: string[];
}

const FIELDS: ClientField[] = ["kyc.status", "kyc.complete", "risk.profile", "risk.score", "client.category", "client.jurisdiction"];
const OPS = ["eq", "neq", "in", "gte", "lte"] as const;

function fieldValue(client: EligibilityClient, field: ClientField): string | number | boolean | null {
  switch (field) {
    case "kyc.status": return client.kycStatus;
    case "kyc.complete": return client.kycComplete;
    case "risk.profile": return client.riskProfile;
    case "risk.score": return client.riskScore;
    case "client.category": return client.category;
    case "client.jurisdiction": return client.jurisdiction;
  }
}

/** Returns null when the predicate holds, otherwise a reason. A malformed node is a failure, never a pass. */
export function evaluatePredicate(node: unknown, client: EligibilityClient): string | null {
  if (!node || typeof node !== "object") return "rule is malformed";
  const n = node as Record<string, unknown>;
  if ("all" in n) {
    if (!Array.isArray(n.all) || n.all.length === 0) return "rule is malformed";
    for (const child of n.all) { const r = evaluatePredicate(child, client); if (r) return r; }
    return null;
  }
  if ("any" in n) {
    if (!Array.isArray(n.any) || n.any.length === 0) return "rule is malformed";
    const reasons: string[] = [];
    for (const child of n.any) { const r = evaluatePredicate(child, client); if (!r) return null; reasons.push(r); }
    return `none of the alternatives hold (${reasons[0]})`;
  }
  if ("not" in n) {
    return evaluatePredicate(n.not, client) === null ? "an excluded condition holds" : null;
  }
  if (!FIELDS.includes(n.field as ClientField) || !OPS.includes(n.op as (typeof OPS)[number])) return "rule is malformed";
  const actual = fieldValue(client, n.field as ClientField);
  if (actual === null || actual === undefined) return `${String(n.field)} is not known for this client`;
  const op = n.op as (typeof OPS)[number];
  const value = n.value as unknown;
  const ok = (() => {
    switch (op) {
      case "eq": return actual === value;
      case "neq": return actual !== value;
      case "in": return Array.isArray(value) && value.includes(String(actual));
      case "gte": return typeof actual === "number" && typeof value === "number" && actual >= value;
      case "lte": return typeof actual === "number" && typeof value === "number" && actual <= value;
    }
  })();
  return ok ? null : `${String(n.field)} does not meet the requirement`;
}

/** Rules in force at `asOf`: effectiveFrom <= asOf and (effectiveTo null or asOf < effectiveTo), for this product only. */
export function rulesInForce(product: EligibilityProduct, asOf: Date): EligibilityRuleRow[] {
  const t = asOf.getTime();
  return product.rules.filter((r) => r.productKey === product.key && r.effectiveFrom.getTime() <= t && (r.effectiveTo === null || t < r.effectiveTo.getTime()));
}

export function evaluateEligibility(product: EligibilityProduct, client: EligibilityClient, asOf: Date): EligibilityResult {
  const reasons: string[] = [];
  if (product.status !== "APPROVED") reasons.push(`product is ${String(product.status).toLowerCase()}, not approved`);

  const inForce = rulesInForce(product, asOf);
  if (inForce.length === 0) reasons.push("no eligibility rule is in force for this product on this date");

  const rulesPassed: string[] = [];
  for (const rule of inForce) {
    const why = evaluatePredicate(rule.predicate, client);
    if (why) reasons.push(`${rule.label}: ${why}`);
    else rulesPassed.push(rule.label);
  }

  if (product.minInvestmentMinor !== null && product.minInvestmentMinor !== undefined) {
    const min = BigInt(product.minInvestmentMinor);
    if (client.investableMinor === undefined) {
      // not checked by this caller
    } else if (client.investableMinor === null) {
      reasons.push("investable amount is unknown, so the minimum ticket cannot be confirmed");
    } else if (BigInt(client.investableMinor) < min) {
      reasons.push("investable amount is below the product minimum");
    }
  }

  return { eligible: reasons.length === 0, reasons, rulesPassed };
}
