import { consentDecision, type ConsentDecision, type ConsentRow } from "./decision";
import { resolvePolicy, type ConsentChannel, type ConsentPolicy, type ConsentPurpose } from "./policy";

/** Master switch. Off unless the value is exactly "1". While off, nothing in this module reads the ledger. */
export const consentEnforced = (env: Record<string, string | undefined> = process.env) => env.CONSENT_ENFORCEMENT === "1";

export type ConsentSnapshot = { records: ConsentRow[]; legacyMarketingConsentAt: Date | null };

export type EnforceDeps = {
  enforced: () => boolean;
  /** One read for any number of customers. A customer with no rows and no form timestamp may be absent from the map. */
  load: (clientIds: string[]) => Promise<Map<string, ConsentSnapshot>>;
  now: () => Date;
  policy: () => ConsentPolicy;
};

export class ConsentDeniedError extends Error {
  readonly code = "CONSENT_DENIED";
  constructor(readonly decision: ConsentDecision) {
    super(`Blocked: ${decision.reason}`);
    this.name = "ConsentDeniedError";
  }
}

const OFF: ConsentDecision = { allowed: true, reason: "ENFORCEMENT_OFF", state: "UNKNOWN" };

/** Production wiring. The Prisma store is imported lazily so a flag-off process never loads it. */
export function defaultEnforceDeps(): EnforceDeps {
  return {
    enforced: () => consentEnforced(),
    load: async (ids) => (await import("./store-prisma")).loadSnapshots(ids),
    now: () => new Date(),
    policy: () => resolvePolicy(process.env),
  };
}

function decide(snap: ConsentSnapshot | undefined, purpose: ConsentPurpose, channel: ConsentChannel | null, d: EnforceDeps): ConsentDecision {
  return consentDecision(snap?.records ?? [], purpose, channel, d.now(), { legacyMarketingConsentAt: snap?.legacyMarketingConsentAt ?? null, policy: d.policy() });
}

/** Non-throwing. Allowed (without reading anything) when enforcement is off. Rejects if the ledger cannot be read: fail closed. */
export async function checkConsent(clientId: string, purpose: ConsentPurpose, channel: ConsentChannel | null, deps: EnforceDeps = defaultEnforceDeps()): Promise<ConsentDecision> {
  if (!deps.enforced()) return OFF;
  const snaps = await deps.load([clientId]);
  return decide(snaps.get(clientId), purpose, channel, deps);
}

/**
 * The hook other agents call before they act on a customer (for example the WhatsApp reply assist, with
 * "AI_PROCESSING_OF_CHATS"). Resolves with the decision, or throws ConsentDeniedError. A no-op while enforcement is off.
 */
export async function assertConsent(clientId: string, purpose: ConsentPurpose, channel: ConsentChannel | null, deps: EnforceDeps = defaultEnforceDeps()): Promise<ConsentDecision> {
  const decision = await checkConsent(clientId, purpose, channel, deps);
  if (!decision.allowed) throw new ConsentDeniedError(decision);
  return decision;
}

/** Keeps the allowed ids in their original order, with one ledger read. Returns the same array untouched while enforcement is off. */
export async function filterConsented(clientIds: string[], purpose: ConsentPurpose, channel: ConsentChannel | null, deps: EnforceDeps = defaultEnforceDeps()): Promise<string[]> {
  if (!deps.enforced() || clientIds.length === 0) return clientIds;
  const snaps = await deps.load(clientIds);
  return clientIds.filter((id) => decide(snaps.get(id), purpose, channel, deps).allowed);
}

export type ConsentGate = (clientId: string) => Promise<{ allowed: boolean; reason?: string }>;

/**
 * For call sites that take an injectable check (the nudger). Returns undefined while enforcement is off, so the site can
 * `...(gate ? { consent: gate } : {})` and a flag-off deps object is byte-for-byte what it was before.
 */
export function consentGate(purpose: ConsentPurpose, channel: ConsentChannel | null, deps: Pick<EnforceDeps, "enforced"> & Partial<EnforceDeps> = defaultEnforceDeps()): ConsentGate | undefined {
  if (!deps.enforced()) return undefined;
  const full = { ...defaultEnforceDeps(), ...deps } as EnforceDeps;
  return async (clientId) => {
    const decision = await checkConsent(clientId, purpose, channel, full);
    return decision.allowed ? { allowed: true } : { allowed: false, reason: "no consent" };
  };
}
