import { googleSignInConfigFromEnv } from "./index";
import { loadGoogleAllowedDomains } from "./settings";

/**
 * Whether to offer "Continue with Google": the flag and both credentials are set AND an admin has allowed at least one
 * company domain. A database error means "not available" (the sign-in page must never fail because of this button).
 */
export async function googleSignInAvailable(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!googleSignInConfigFromEnv(env).enabled) return false;
  try {
    return (await loadGoogleAllowedDomains()).length > 0;
  } catch {
    return false;
  }
}
