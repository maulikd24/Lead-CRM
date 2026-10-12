import type { Prisma } from "@/generated/prisma/client";
import { resolvePolicy, type ConsentPolicy } from "./policy";

/**
 * A cheap query-side pre-filter for bulk selection: customers with no marketing consent evidence at all (no lead-form
 * timestamp and no GRANTED row) can never be allowed when marketing is a `required` purpose, so they are left out of the
 * query. It is only a pre-filter: the full decision (do-not-contact, later withdrawal, expiry) is applied afterwards.
 * Returns undefined when marketing is not `required` (for example switched to record only), so nothing is filtered.
 */
export function coarseMarketingWhere(policy: ConsentPolicy = resolvePolicy(process.env)): Prisma.ClientWhereInput | undefined {
  if (policy.MARKETING_COMMS.mode !== "required") return undefined;
  return { OR: [{ marketingConsentAt: { not: null } }, { consentRecords: { some: { purpose: "MARKETING_COMMS", status: "GRANTED" } } }] };
}
