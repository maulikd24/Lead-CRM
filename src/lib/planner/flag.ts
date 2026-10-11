/** The campaign planner shows only when this build-time flag is exactly "1". Off by default; a flag-off planner is absent, not greyed out. */
export function plannerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_PLANNER === "1";
}
