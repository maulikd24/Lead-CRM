/** The call recordings review (/calls) ships dark: it only appears when NEXT_PUBLIC_CALLS_REVIEW=1 (build-time). */
export function callsReviewEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_CALLS_REVIEW === "1";
}

/** Roles that may open the call review pages, the recording proxy and the actions. */
export const CALLS_ROLES = ["ADMIN", "MANAGER", "RM"] as const;
