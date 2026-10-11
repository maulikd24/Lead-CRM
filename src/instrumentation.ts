/**
 * Runs once when a server instance starts (Next.js instrumentation hook). Node runtime only.
 * Today it holds the flag check (src/lib/flags/startup.ts): production stops on a safety-rule error, development warns.
 * Other startup work added later extends this one function.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { enforceFlagCheck } = await import("@/lib/flags/startup");
  enforceFlagCheck(process.env);
}
