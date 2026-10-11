import { INCLUDED_REVENUE_TYPES, netRevenue, type RevenueEventLite } from "@/lib/marketing/revenue";

import type { IntakeTouch } from "./model";

/** Small pure mappers from database rows to the inputs of the attribution model, shared by the single-customer and the bulk loaders. */

type Json = unknown;

function asRecord(v: Json): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** A LeadIntake ledger row as a touch. The intake stored what it normalised under `rawPayload.normalized`; any other shape (an erased tombstone, a failed row) yields no attribution. */
export function intakeTouch(row: { source: string; externalId: string; receivedAt: Date; rawPayload: Json }): IntakeTouch {
  const normalized = asRecord(asRecord(row.rawPayload)?.normalized);
  const attribution = asRecord(normalized?.attribution);
  const leadSource = typeof normalized?.leadSource === "string" ? normalized.leadSource : null;
  return {
    source: row.source,
    externalId: row.externalId,
    at: row.receivedAt,
    leadSource,
    // The client's own snapshot carries source and externalId; so does the normalised attribution once the intake cleaned it, so add them here too.
    attribution: attribution ? { ...attribution, source: row.source, externalId: row.externalId } : null,
  };
}

/** First funding: the earliest successful funds-in payment, or the funding date of a (partly) funded record, whichever is earlier. Never invented: a funded record with no date has no date. */
export function fundedAtOf(input: { payments: Date[]; funding: { status: string; fundingDate: Date | null } | null }): Date | null {
  const dates: Date[] = [...input.payments];
  if (input.funding && (input.funding.status === "PARTIALLY_FUNDED" || input.funding.status === "FULLY_FUNDED") && input.funding.fundingDate) dates.push(input.funding.fundingDate);
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

export type RevenueRow = RevenueEventLite & { eventDate: Date };

const counted = (type: string | null) => type !== null && (INCLUDED_REVENUE_TYPES as readonly string[]).includes(type);
const monthOf = (d: Date) => d.toISOString().slice(0, 7);

/** Net revenue as the marketing module counts it (brokerage and advisory fees, reversals subtract), plus when it first arrived and how it falls by calendar month. */
export function revenueSummary(rows: RevenueRow[]): { total: number; firstAt: Date | null; byMonth: Record<string, number> } {
  const byMonth: Record<string, number> = {};
  let firstAt: Date | null = null;
  for (const e of rows) {
    if (e.reversesEventId) {
      if (counted(e.reversedType)) byMonth[monthOf(e.eventDate)] = (byMonth[monthOf(e.eventDate)] ?? 0) - Math.abs(e.amount);
    } else if (counted(e.revenueType)) {
      byMonth[monthOf(e.eventDate)] = (byMonth[monthOf(e.eventDate)] ?? 0) + e.amount;
      if (!firstAt || e.eventDate.getTime() < firstAt.getTime()) firstAt = e.eventDate;
    }
  }
  return { total: netRevenue(rows), firstAt, byMonth };
}
