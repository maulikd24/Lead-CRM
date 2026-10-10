/** The referral programme ships dark: nothing is shown, written or reachable unless REFERRAL_PROGRAM_ENABLED is exactly "1". */
export function referralEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.REFERRAL_PROGRAM_ENABLED === "1";
}
