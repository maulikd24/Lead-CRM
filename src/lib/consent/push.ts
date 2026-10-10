import { checkConsent, type EnforceDeps } from "./enforce";
import type { ConsentDecision } from "./decision";

/**
 * What the CleverTap push does for a customer when enforcement is on:
 *   ok     marketing consent is current: push as usual.
 *   pause  the customer withdrew, or asked not to be contacted: push the existing av_sales_paused signal as true so campaigns suppress them.
 *   skip   no consent on file (or it lapsed): share nothing.
 * No new profile property is introduced: av_sales_paused is already on the allowlist.
 */
export type PushStance = "ok" | "pause" | "skip";

export function pushStance(decision: ConsentDecision): PushStance {
  if (decision.allowed) return "ok";
  return decision.reason === "WITHDRAWN" || decision.reason === "DO_NOT_CONTACT" ? "pause" : "skip";
}

export const pushStanceFor = async (clientId: string, deps?: EnforceDeps): Promise<PushStance> =>
  pushStance(await checkConsent(clientId, "MARKETING_COMMS", "push", deps));

/** `loaded` is the pusher's load() result. Returns null to skip the customer; never mutates its input. */
export function applyPushStance<T extends { signals: { salesPaused: boolean } }>(loaded: T, stance: PushStance): T | null {
  if (stance === "skip") return null;
  if (stance === "pause") return { ...loaded, signals: { ...loaded.signals, salesPaused: true } };
  return loaded;
}
