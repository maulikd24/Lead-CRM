/**
 * JOURNEYS_ENABLED (server, default off). When it is not exactly "1", the customer-journey loader does nothing and reads nothing.
 * Registered in src/lib/flags/registry.ts.
 */
export const JOURNEYS_FLAG = "JOURNEYS_ENABLED";

export const customerJourneysEnabled = (env: Record<string, string | undefined> = process.env): boolean => env[JOURNEYS_FLAG] === "1";
