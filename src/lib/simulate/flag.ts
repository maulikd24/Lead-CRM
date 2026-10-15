/** The simulate() preview on bulk actions (first use: bulk follow-up task creation on the customer list). Off unless NEXT_PUBLIC_SIMULATE is exactly "1" (build-time). */
export const SIMULATE_FLAG = "NEXT_PUBLIC_SIMULATE";
export const simulateEnabled = (env?: Record<string, string | undefined>): boolean => (env ? env[SIMULATE_FLAG] : process.env.NEXT_PUBLIC_SIMULATE) === "1";
