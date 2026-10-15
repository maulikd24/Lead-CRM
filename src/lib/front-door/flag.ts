/** The front door (designed landing page at the root and the redesigned sign-in page). Off unless exactly "1". */
export function landingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_LANDING === "1";
}
