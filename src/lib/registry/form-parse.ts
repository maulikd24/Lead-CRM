import type { ContentInput, EligibilityRule, MarketingClaim, SalesRestriction } from "./model";
import { ELIGIBILITY_KINDS } from "./model";

/** Turns the admin form's plain text fields into the structured input `validateContent` checks. Pure. Line based on purpose: no JSON for an admin to type. */

const lines = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
const parts = (line: string): string[] => line.split("|").map((p) => p.trim());

/** "1,00,000" or "2500.50" rupees to minor units (paise). Empty is null; garbage is NaN (the validator refuses it). */
export function rupeesToMinor(text: string): number | null {
  const t = text.replace(/[,\s]/g, "");
  if (t === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return Number.NaN;
  return Math.round(Number(t) * 100);
}
export const minorToRupees = (minor: number | null): string => (minor === null ? "" : String(minor / 100));

export function parseClaims(text: string): MarketingClaim[] {
  return lines(text).map((l, i) => {
    const p = parts(l);
    if (p.length === 1) return { id: `claim-${i + 1}`, text: p[0], validUntil: null };
    return { id: p[0], text: p[1] ?? "", validUntil: p[2] ? p[2] : null };
  });
}
export function parseRestrictions(text: string): SalesRestriction[] {
  return lines(text).map((l, i) => {
    const p = parts(l);
    return p.length === 1 ? { code: `restriction-${i + 1}`, text: p[0] } : { code: p[0], text: p[1] ?? "" };
  });
}
export function parseEligibility(text: string): EligibilityRule[] {
  return lines(text).map((l, i) => {
    const m = l.match(/^([a-z_]+)\s*:\s*(.+)$/);
    const kind = m && (ELIGIBILITY_KINDS as readonly string[]).includes(m[1]) ? (m[1] as EligibilityRule["kind"]) : "other";
    return { code: `${kind}-${i + 1}`, kind, value: kind === "other" && !(m && m[1] === "other") ? l : (m ? m[2] : l) };
  });
}

export const formatLines = {
  claims: (c: MarketingClaim[]) => c.map((x) => [x.id, x.text, x.validUntil?.slice(0, 10) ?? ""].filter((p, i) => i < 2 || p).join(" | ")).join("\n"),
  restrictions: (r: SalesRestriction[]) => r.map((x) => `${x.code} | ${x.text}`).join("\n"),
  eligibility: (e: EligibilityRule[]) => e.map((x) => `${x.kind}: ${x.value}`).join("\n"),
};

export type FormFields = Record<"name" | "category" | "summary" | "availability" | "minInvestment" | "currency" | "riskCategory" | "jurisdictions" | "requiredDocuments" | "eligibility" | "restrictions" | "claims" | "validFrom" | "validTo", string>;

export function formToContentInput(f: FormFields): ContentInput {
  return {
    name: f.name,
    category: f.category,
    summary: f.summary,
    availability: f.availability,
    minInvestmentMinor: rupeesToMinor(f.minInvestment),
    currency: f.currency.trim().toUpperCase(),
    riskCategory: f.riskCategory,
    jurisdictions: f.jurisdictions.split(",").map((j) => j.trim()).filter(Boolean),
    requiredDocuments: lines(f.requiredDocuments),
    eligibility: parseEligibility(f.eligibility),
    salesRestrictions: parseRestrictions(f.restrictions),
    claims: parseClaims(f.claims),
    validFrom: f.validFrom.trim() === "" ? null : f.validFrom,
    validTo: f.validTo.trim() === "" ? null : f.validTo,
  };
}
