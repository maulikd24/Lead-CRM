import type { PushResult } from "./pusher";

export type BatchResult = { pushed: number; unchanged: number; skipped: number; retry: number; failed: number };

/** Sequential, isolated per customer; stops at the first 429-style retry. */
export async function runBatch(clientIds: string[], push: (clientId: string) => Promise<PushResult>): Promise<BatchResult> {
  const out: BatchResult = { pushed: 0, unchanged: 0, skipped: 0, retry: 0, failed: 0 };
  for (const id of clientIds) {
    let res: PushResult;
    try {
      res = await push(id);
    } catch (error) {
      console.error("CleverTap push: unexpected error for one customer", error);
      out.failed++;
      continue;
    }
    out[res.status]++;
    if (res.status === "retry") break;
  }
  return out;
}

/** Wraps a push so every non-retry outcome marks the customer as checked; a failing mark never changes the result. */
export function checkedAfter(push: (clientId: string) => Promise<PushResult>, markChecked: (clientId: string) => Promise<void>) {
  return async (clientId: string): Promise<PushResult> => {
    const res = await push(clientId);
    if (res.status !== "retry") {
      try {
        await markChecked(clientId);
      } catch (error) {
        console.error("CleverTap push: could not record the check time", error);
      }
    }
    return res;
  };
}
