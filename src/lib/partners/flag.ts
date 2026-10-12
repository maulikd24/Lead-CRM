/** The Partner workspace ships dark: nothing is shown or reachable unless PARTNER_WORKSPACE_ENABLED is exactly "1". */
export function isPartnerWorkspaceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PARTNER_WORKSPACE_ENABLED === "1";
}
