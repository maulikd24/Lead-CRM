import { pseudonymize } from "@/lib/access/pseudonym";

/**
 * What a MARKETING viewer sees in place of a customer on Campaign impact. Both come from the access module's
 * pseudonymiser (the one pseudonymiser in the codebase), so the label and the id always agree and neither can be
 * recomputed without the server secret.
 */
export const standInId = (clientId: string): string => pseudonymize(clientId);
export const standInName = (clientId: string): string => `Lead ${pseudonymize(clientId).slice(2, 7)}`;
