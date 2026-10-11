import { canAccessMarketing } from "@/lib/access/marketing-access";

/** Feature switches for the creative and director-report modules. Both default OFF and are on only for the exact value "1". */

/** Creative intelligence, ad copy drafts, competitor ads and experiments. Build-time (NEXT_PUBLIC_*). */
export function creativeIntelEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_CREATIVE_INTEL === "1";
}

/** Director reports (shareable links, printable page) and the weekly digest job. */
export function directorReportsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DIRECTOR_REPORTS_ENABLED === "1";
}

/** What a person may see: the flag AND the role, decided in one place. */
export function creativeAccess(role: string, env: Record<string, string | undefined> = process.env): { creative: boolean; reports: boolean } {
  const allowed = canAccessMarketing(role);
  return { creative: allowed && creativeIntelEnabled(env), reports: allowed && directorReportsEnabled(env) };
}
