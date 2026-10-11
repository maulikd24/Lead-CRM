import type { NavFlag } from "@/lib/nav-flags";

type Env = Record<string, string | undefined>;

/**
 * Nav flags that are ON but not usable yet because something they need is missing. Shown to ADMIN as "Needs setup" beside the item.
 * Reads only environment presence (never a value), so it is safe to compute in the layout on every request.
 */
export function navSetupNeeded(enabled: readonly string[], env: Env = process.env): NavFlag[] {
  const on = (f: NavFlag) => enabled.includes(f);
  const out: NavFlag[] = [];
  if (on("referral-program") && !env.REFERRAL_LINK_BASE) out.push("referral-program");
  if (on("backoffice-import") && !env.BACKOFFICE_IMPORT_DIR) out.push("backoffice-import");
  if (on("google-signin") && !(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)) out.push("google-signin");
  if (on("marketing") && env.META_ADS_SYNC_ENABLED !== "1" && env.GOOGLE_ADS_REPORTING_ENABLED !== "1") out.push("marketing");
  return out;
}
