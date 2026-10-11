/**
 * Action Ledger flags. Both default OFF (registry: src/lib/flags/registry.ts). Build-time names are read by their literal name so Next inlines them.
 *  - NEXT_PUBLIC_ACTION_LEDGER: the Why tab on Customer 360 and the read API (customer, campaign).
 *  - NEXT_PUBLIC_ACTION_LEDGER_INVESTIGATE: the ADMIN-only "Investigate an action" page and its API, in the control plane area.
 */
type Env = Record<string, string | undefined>;
export const actionLedgerEnabled = (env?: Env): boolean => (env ? env.NEXT_PUBLIC_ACTION_LEDGER : process.env.NEXT_PUBLIC_ACTION_LEDGER) === "1";
export const actionLedgerInvestigateEnabled = (env?: Env): boolean => (env ? env.NEXT_PUBLIC_ACTION_LEDGER_INVESTIGATE : process.env.NEXT_PUBLIC_ACTION_LEDGER_INVESTIGATE) === "1";
