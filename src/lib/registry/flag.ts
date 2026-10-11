/**
 * The Product and Eligibility Registry screens and nav items. Off unless NEXT_PUBLIC_PRODUCT_REGISTRY is exactly "1" (build-time).
 * Read by its literal name so Next inlines it. The data layer (cite(), the tables) is not behind the flag: nothing calls it until a screen or agent does.
 */
export const PRODUCT_REGISTRY_FLAG = "NEXT_PUBLIC_PRODUCT_REGISTRY";
export const productRegistryEnabled = (env?: Record<string, string | undefined>): boolean => (env ? env[PRODUCT_REGISTRY_FLAG] : process.env.NEXT_PUBLIC_PRODUCT_REGISTRY) === "1";
