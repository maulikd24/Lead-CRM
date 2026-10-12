/** Customer outcomes and goals UI and actions (build-time client flag, same convention as NEXT_PUBLIC_C360). Off unless exactly "1". */
export function outcomesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_OUTCOMES === "1";
}
