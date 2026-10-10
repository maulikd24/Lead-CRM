/**
 * Feature flags that can hide a sidebar / Cmd+K / Help / tour item. This is the ONE place nav flags are evaluated:
 * a nav item names a flag (`flag: "calls-review"`), and `enabledNavFlags()` reports which flags are on right now.
 * Each entry reuses the same predicate the page itself uses, so a menu item and its page can never disagree.
 *
 * Evaluate on the server (the dashboard layout does) and pass the resulting list to client components; do not read
 * the env vars from nav items or from client code. Kept free of server-only imports so tests and client code can
 * import the types. All flags are off unless their env var is exactly "1".
 */
import { backofficeImportEnabled } from "@/lib/backoffice-import/flag";
import { callsReviewEnabled } from "@/lib/calls/flag";
import { mergeReviewEnabled } from "@/lib/identity/merge-review/flag";
import { supportSlaEnabled } from "@/lib/integrations/freshdesk/flags";
import { marketingPageEnabled } from "@/lib/marketing/flags";
import { isPartnerWorkspaceEnabled } from "@/lib/partners/flag";

type Env = Record<string, string | undefined>;

export const NAV_FLAGS = {
  "partner-workspace": (env: Env) => isPartnerWorkspaceEnabled(env),
  "calls-review": (env: Env) => callsReviewEnabled(env),
  "merge-review": (env: Env) => mergeReviewEnabled(env),
  "support-sla": (env: Env) => supportSlaEnabled(env),
  marketing: (env: Env) => marketingPageEnabled(env),
  "backoffice-import": (env: Env) => backofficeImportEnabled(env),
} as const satisfies Record<string, (env: Env) => boolean>;

export type NavFlag = keyof typeof NAV_FLAGS;

/** The nav flags that are on for this environment (default: this process's). */
export function enabledNavFlags(env: Env = process.env): NavFlag[] {
  return (Object.keys(NAV_FLAGS) as NavFlag[]).filter((flag) => NAV_FLAGS[flag](env));
}
