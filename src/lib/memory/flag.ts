/**
 * Feature flags for Wave 2 workstream B. All default OFF (registry: src/lib/flags/registry.ts). Build-time names (NEXT_PUBLIC_*)
 * need a rebuild to change; the server names are read at run time.
 */
export const memoryEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.NEXT_PUBLIC_MEMORY === "1";
export const serviceStateEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.NEXT_PUBLIC_SERVICE_STATE === "1";
export const householdIntelligenceEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.HOUSEHOLD_INTELLIGENCE_ENABLED === "1";
