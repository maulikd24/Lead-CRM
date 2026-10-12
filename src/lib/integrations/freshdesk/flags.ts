/** Off by default. Hand-off events are only acted on when this is "1". */
export const handoffEnabled = (): boolean => process.env.FRESHDESK_HANDOFF_ENABLED === "1";

/** The /support manager view and its nav item. NEXT_PUBLIC_ so the sidebar can read it. */
export const supportSlaEnabled = (env: Record<string, string | undefined> = process.env): boolean => env.NEXT_PUBLIC_SUPPORT_SLA === "1";
