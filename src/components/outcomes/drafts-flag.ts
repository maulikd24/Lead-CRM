/** Whether the draft-message button is offered at all: the outcomes agent's own env flag (the kill-switch row is checked again when a draft is requested). */
export const drafts = (env: Record<string, string | undefined> = process.env) => env.OUTCOMES_DRAFTS_ENABLED === "1";
