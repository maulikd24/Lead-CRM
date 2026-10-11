/**
 * Feature flags for Wave 2 workstream B. All default OFF (registry: src/lib/flags/registry.ts). Build-time names (NEXT_PUBLIC_*)
 * need a rebuild to change and are read by their literal name so Next inlines them; the server name is read at run time.
 */
type Env = Record<string, string | undefined>;
export const memoryEnabled = (env?: Env): boolean => (env ? env.NEXT_PUBLIC_MEMORY : process.env.NEXT_PUBLIC_MEMORY) === "1";
export const serviceStateEnabled = (env?: Env): boolean => (env ? env.NEXT_PUBLIC_SERVICE_STATE : process.env.NEXT_PUBLIC_SERVICE_STATE) === "1";
export const householdIntelligenceEnabled = (env?: Env): boolean => (env ? env.HOUSEHOLD_INTELLIGENCE_ENABLED : process.env.HOUSEHOLD_INTELLIGENCE_ENABLED) === "1";
