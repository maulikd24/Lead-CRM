/** The one switch for the unified Approvals inbox (/approvals). Off unless exactly "1". Per-adapter write-through switches live on the definitions. */
export const approvalsInboxEnabled = (env: Record<string, string | undefined> = process.env) => env.APPROVALS_INBOX_ENABLED === "1";
