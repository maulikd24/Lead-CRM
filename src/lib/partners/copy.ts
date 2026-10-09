import type { ReferralApiErrorKind } from "./referral-api";

const COPY: Record<ReferralApiErrorKind, { title: string; description: string }> = {
  not_configured: { title: "Not connected", description: "Ask an administrator to connect the referral API in Settings." },
  unauthorized: { title: "The connection was refused", description: "The saved credential is no longer accepted. Ask an administrator to check it in Settings." },
  forbidden: { title: "No permission for this data", description: "The saved credential is not allowed to read this. Ask an administrator to review it in Settings." },
  not_found: { title: "Not found", description: "That record is not in the referral programme any more." },
  bad_request: { title: "Could not load this view", description: "The request was not accepted. Try changing the filters, or come back in a moment." },
  rate_limited: { title: "Too many requests", description: "The referral API asked us to slow down. Wait a minute and refresh." },
  server: { title: "The referral service had a problem", description: "Nothing is wrong with your data. Try again in a moment." },
  timeout: { title: "The referral service is slow", description: "It did not answer in time. Try again in a moment." },
  network: { title: "Cannot reach the referral service", description: "Try again in a moment. If it keeps happening, ask an administrator to check the connection in Settings." },
  invalid_response: { title: "Unexpected answer from the referral service", description: "The data came back in a shape we do not recognise. Tell an administrator." },
};

export const errorCopy = (kind: ReferralApiErrorKind) => COPY[kind];
