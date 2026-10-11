import { after } from "next/server";

import { jobRunStore } from "./job-run-db";
import { createWithRunRecord } from "./webhook-run";

/** Wrap a webhook or ingest route handler: `export const POST = withRunRecord(jobSpec("webhook:x")!, async (request) => { ... })`. */
export const withRunRecord = createWithRunRecord({
  store: jobRunStore,
  schedule: (fn) => {
    try {
      after(fn);
    } catch {
      // Outside a request scope (a unit test of a route): fall back to a background promise that can never reject.
      void fn().catch(() => {});
    }
  },
});
