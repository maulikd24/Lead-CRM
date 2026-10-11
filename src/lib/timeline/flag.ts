/**
 * Customer 360's timeline and the AI summary context read the canonical timeline reader only when CUSTOMER_TIMELINE_V2 is exactly "1" (server side, read per
 * request). Off by default: both keep their original loaders, untouched.
 */
export const CUSTOMER_TIMELINE_FLAG = "CUSTOMER_TIMELINE_V2";
export const customerTimelineV2Enabled = (env: Record<string, string | undefined> = process.env): boolean => env[CUSTOMER_TIMELINE_FLAG] === "1";
