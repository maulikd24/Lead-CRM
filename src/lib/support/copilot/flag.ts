/** Off unless the environment says "1" (the same rule as every other flag). The all-on profile turns it on. */
export const COPILOT_FLAG = "FRESHDESK_COPILOT_ENABLED";

export const copilotEnabled = (env: Record<string, string | undefined> = process.env): boolean => env[COPILOT_FLAG] === "1";

/** The panel is shown only where the co-pilot flag and the Support SLA screen are both on. Flag off: no panel, no model call, no send. */
export const copilotPanelVisible = (env: Record<string, string | undefined> = process.env): boolean => copilotEnabled(env) && env.NEXT_PUBLIC_SUPPORT_SLA === "1";
