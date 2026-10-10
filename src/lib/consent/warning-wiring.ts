import { loadSnapshots } from "./store-prisma";
import { consentWarning, type ConsentWarning } from "./view";

/** For the inbox. Reads the ledger and the lead-form timestamp for one customer. Information only: independent of CONSENT_ENFORCEMENT. */
export async function consentWarningFor(clientId: string, now: Date = new Date()): Promise<ConsentWarning | null> {
  const snap = (await loadSnapshots([clientId])).get(clientId);
  return snap ? consentWarning(snap.records, snap.legacyMarketingConsentAt, now) : null;
}
