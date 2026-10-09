/** The Partner workspace ships dark: nothing is shown or reachable unless PARTNER_WORKSPACE_ENABLED is exactly "1". */
export function isPartnerWorkspaceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PARTNER_WORKSPACE_ENABLED === "1";
}

// Constant arrays, so client components that depend on them see a stable identity.
const ON: string[] = Object.freeze(["partner-workspace"]) as unknown as string[];
const OFF: string[] = Object.freeze([]) as unknown as string[];

/** Nav flags that are on right now, for passing to client components. */
export function enabledNavFlags(env: Record<string, string | undefined> = process.env): string[] {
  return isPartnerWorkspaceEnabled(env) ? ON : OFF;
}
