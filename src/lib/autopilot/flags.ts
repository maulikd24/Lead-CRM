/** Feature switches for Autopilot. Free of server-only imports so client code (the sidebar) can read them. */

/** The /autopilot page and its menu item show only when this build-time flag is exactly "1". Off by default. */
export function autopilotPageEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_AUTOPILOT === "1";
}

/**
 * Applying an approved action to a live ad account is possible only when this is exactly "1" AND a real action
 * provider has been configured by an Admin. Off by default: with it off, "Approve" records the decision and stops.
 */
export function autopilotApplyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AUTOPILOT_APPLY_ENABLED === "1";
}

/** "Ask Autopilot" shows only when this is exactly "1". The model is optional; without it a fixed keyword router answers. */
export function autopilotAskEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AUTOPILOT_ASK_ENABLED === "1";
}
