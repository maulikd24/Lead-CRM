/** Customer events are written only when CUSTOMER_EVENTS_ENABLED is exactly "1". Off by default: the old behaviour is untouched. Read at call time (server only). */
export const CUSTOMER_EVENTS_FLAG = "CUSTOMER_EVENTS_ENABLED";
export const customerEventsEnabled = (env: Record<string, string | undefined> = process.env): boolean => env[CUSTOMER_EVENTS_FLAG] === "1";
