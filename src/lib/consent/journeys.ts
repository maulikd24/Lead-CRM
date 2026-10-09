import { checkConsent, type EnforceDeps } from "./enforce";
import type { ConsentChannel, ConsentPurpose } from "./policy";

export type JourneyBlock = { success: true; result: { skipped: true; reason: string } };

type Log = (clientId: string, message: string, reason: string) => Promise<unknown>;

/**
 * For a journey send node. Returns null (send as before, and nothing is read) while enforcement is off. When enforcement is on
 * and the customer may not be contacted, logs "blocked: no consent" on the customer and returns a successful skip, so the
 * journey carries on to its next node without sending. A node can opt into service messages with `config.purpose`.
 * If the ledger cannot be read the send is blocked (fail closed).
 */
export async function journeyConsentBlock(
  clientId: string,
  channel: ConsentChannel,
  config: Record<string, unknown>,
  log: Log,
  deps?: EnforceDeps,
): Promise<JourneyBlock | null> {
  const purpose: ConsentPurpose = config.purpose === "SERVICE_COMMS" ? "SERVICE_COMMS" : "MARKETING_COMMS";
  let reason: string | null = null;
  try {
    const decision = await checkConsent(clientId, purpose, channel, deps);
    if (!decision.allowed) reason = "blocked: no consent";
  } catch {
    reason = "blocked: consent check failed";
  }
  if (!reason) return null;
  await log(clientId, `Journey skipped a ${channel} send (${reason})`, reason);
  return { success: true, result: { skipped: true, reason } };
}
