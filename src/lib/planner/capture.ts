import { isCampaignCode } from "./naming";

/**
 * The seam between a campaign plan and the lead intake. The intake already stores every attribution key a source sends
 * (`leadAttribution`), so tracked links add one key, `campaign_code`. A click-to-WhatsApp chat carries the code in its
 * first message as "(Ref: CP-XXXXXX)". Pure; no customer data is read here.
 */
const REF_IN_TEXT = /\bRef:\s*(CP-[A-Za-z0-9]{6})\b/i;

export function extractCampaignCode(input: { attribution?: Record<string, string | undefined> | null; message?: string | null }): string | null {
  const explicit = input.attribution?.campaign_code?.trim().toUpperCase();
  if (explicit && isCampaignCode(explicit)) return explicit;
  const m = input.message ? REF_IN_TEXT.exec(input.message) : null;
  const fromText = m?.[1].toUpperCase();
  return fromText && isCampaignCode(fromText) ? fromText : null;
}

export type OutcomeRow = { code: string; kyc: boolean; funded: boolean };
export type Tally = { leads: number; kyc: number; funded: number };

export function tallyOutcomes(rows: OutcomeRow[]): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const r of rows) {
    const t = out.get(r.code) ?? { leads: 0, kyc: 0, funded: 0 };
    t.leads += 1;
    if (r.kyc) t.kyc += 1;
    if (r.funded) t.funded += 1;
    out.set(r.code, t);
  }
  return out;
}

/** One history row per past plan that actually produced leads. */
export function historyFromOutcomes(plans: { code: string; budgetInr: number | null }[], tally: Map<string, Tally>): { leads: number; kyc: number; funded: number; budgetInr: number | null }[] {
  return plans.flatMap((p) => {
    const t = tally.get(p.code);
    return t ? [{ ...t, budgetInr: p.budgetInr }] : [];
  });
}
