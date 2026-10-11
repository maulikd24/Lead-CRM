import type { OutboxStore } from "./types";

/**
 * Called after a consent row is written. A withdrawal of ad measurement takes the customer's not-yet-sent events out of the queue at
 * once. It is a courtesy on top of the real guard: the drain re-checks consent for every row at send time, so a failure here can never
 * let anything leave, and it must never break the consent write itself.
 */
export async function cancelOnWithdrawal(store: OutboxStore, row: { clientId: string; purpose: string; status: string }): Promise<number> {
  if (row.purpose !== "ADS_MEASUREMENT" || row.status !== "WITHDRAWN") return 0;
  try {
    return await store.cancelUnsentForClient(row.clientId, "CONSENT_WITHDRAWN");
  } catch {
    return 0;
  }
}
