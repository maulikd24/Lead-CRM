import type { MessageSuggestion } from "@/lib/copilot/message-suggestion";

/**
 * Which actions a Co-pilot worklist row shows. The primary action stays visible on the row; every other action sits in the
 * row's "More" menu. Nothing is removed: each action listed here is reachable from the row, with the same target as before.
 */
export type QuickActionPlan = {
  /** Always visible on the row. Opens the Schedule Follow-up dialog (which carries the access-checked createTaskAction). */
  primary: { kind: "followup"; label: string };
  /** Listed in the "More" menu. Empty means the row shows no "More" button. */
  overflow: { kind: "message"; label: string; href: string }[];
};

/** The link to the client page with the suggested message pre-filled. Same URL shape the row always used. */
export function suggestedMessageHref(clientId: string, suggestion: MessageSuggestion): string {
  return `/clients/${clientId}?suggestChannel=${suggestion.channel}&suggestTemplateId=${suggestion.templateId}&suggestVars=${encodeURIComponent(JSON.stringify(suggestion.variables))}#send-message`;
}

export function quickActionPlan(clientId: string, messageSuggestion: MessageSuggestion | null): QuickActionPlan {
  return {
    primary: { kind: "followup", label: "Follow-up" },
    overflow: messageSuggestion ? [{ kind: "message", label: "Suggested message", href: suggestedMessageHref(clientId, messageSuggestion) }] : [],
  };
}
