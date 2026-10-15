// The expiry sweep as a scheduled job: marks memory items whose freshness window has lapsed as EXPIRED (reads already treat lapsed items as expired, so
// correctness never depends on this running; it keeps the stored state and the audit trail honest). Idempotent: a second run expires nothing new.
import { expireDueMemoryItems } from "./store";

export async function runMemoryExpirySweep(opts: { now?: Date; limit?: number } = {}): Promise<{ job: "memory-expiry-sweep"; expired: number }> {
  const r = await expireDueMemoryItems(opts);
  return { job: "memory-expiry-sweep", expired: r.expired };
}
