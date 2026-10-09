/** The call recordings review (/calls) ships dark: it only appears when NEXT_PUBLIC_CALLS_REVIEW=1 (build-time). */
export function callsReviewEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CALLS_REVIEW === "1";
}

/** Roles that may open the call review pages, the recording proxy and the actions. */
export const CALLS_ROLES = ["ADMIN", "MANAGER", "RM"] as const;
