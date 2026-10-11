import { createHash } from "node:crypto";

/**
 * The conversion events, and how they are read off data the CRM already holds. Nothing here writes: it only looks at
 * facts (KYC approved and when, funding status and when, optionally an AUM figure) and says which events they imply.
 */
export const EVENT_TYPES = ["KYC_COMPLETE", "FIRST_FUNDING", "AUM_BAND"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABEL: Record<EventType, string> = { KYC_COMPLETE: "KYC complete", FIRST_FUNDING: "First funding", AUM_BAND: "Assets band reached" };

/** Default bands in rupees: labelled defaults, configurable in Destinations. A band is reached at or above its threshold. */
export type AumBand = { label: string; min: number };
export const DEFAULT_AUM_BANDS: AumBand[] = [
  { label: "10L", min: 1_000_000 },
  { label: "50L", min: 5_000_000 },
  { label: "1Cr", min: 10_000_000 },
];

export type ClientFacts = {
  clientId: string;
  kyc: { status: string; completionDate: Date | null } | null;
  funding: { status: string; fundingDate: Date | null; amount: number | null } | null;
  aum: number | null;
  aumAsOf: Date | null;
};

export type DetectedEvent = { type: EventType; qualifier: string; dedupId: string; occurredAt: Date; amount?: number | null };

/** One id per customer, event type and band, forever: a re-run, a retry or a second sweep can never create a second event. Non-reversible without the customer id. */
export function dedupIdFor(clientId: string, type: EventType, qualifier = ""): string {
  return `cl1_${createHash("sha256").update(`${clientId}|${type}|${qualifier}`).digest("hex").slice(0, 32)}`;
}

export function detectEvents(facts: ClientFacts, opts: { aumBands: AumBand[] | null }): DetectedEvent[] {
  const out: DetectedEvent[] = [];
  const { clientId } = facts;
  if (facts.kyc?.status === "APPROVED" && facts.kyc.completionDate) {
    out.push({ type: "KYC_COMPLETE", qualifier: "", dedupId: dedupIdFor(clientId, "KYC_COMPLETE"), occurredAt: facts.kyc.completionDate });
  }
  if ((facts.funding?.status === "PARTIALLY_FUNDED" || facts.funding?.status === "FULLY_FUNDED") && facts.funding.fundingDate) {
    out.push({ type: "FIRST_FUNDING", qualifier: "", dedupId: dedupIdFor(clientId, "FIRST_FUNDING"), occurredAt: facts.funding.fundingDate, amount: facts.funding.amount });
  }
  if (opts.aumBands && facts.aum != null && facts.aumAsOf) {
    const reached = [...opts.aumBands].sort((a, b) => b.min - a.min).find((b) => facts.aum! >= b.min);
    if (reached) out.push({ type: "AUM_BAND", qualifier: reached.label, dedupId: dedupIdFor(clientId, "AUM_BAND", reached.label), occurredAt: facts.aumAsOf });
  }
  return out.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

/** The only money figure that can leave: rounded to the nearest 10,000 rupees, and only when a destination is set to send values. */
export function roundedValue(amount: number | null | undefined): number | null {
  if (amount == null || !(amount > 0)) return null;
  return Math.round(amount / 10_000) * 10_000;
}
