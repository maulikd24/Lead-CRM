/**
 * The autonomy ladder, per (agent, action type). Ceilings are enforced in CODE, not by convention or by a stored row:
 *
 *   L0 observe   L1 analyse   L2 recommend   L3 draft   L4 execute after human approval   L5 auto-execute (internal, reversible, non-customer only)
 *
 * Owner-confirmed ceilings: a customer-facing send is L3 or L4 only and is never automatic; an ad-spend change is L4 at most;
 * L5 exists only for internal, reversible, non-customer actions (for example retrying a failed idempotent sync).
 * Auto-send and autonomous ad spend are NOT YET.
 */
export const AUTONOMY_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const LEVEL_LABEL: Record<AutonomyLevel, string> = { 0: "L0 observe", 1: "L1 analyse", 2: "L2 recommend", 3: "L3 draft", 4: "L4 execute after approval", 5: "L5 auto-execute" };

/** What an action does to the outside world decides its ceiling. */
export type ActionClass = "read" | "internal_write" | "internal_reversible" | "customer_send" | "ad_spend";

export const CEILING: Record<ActionClass, AutonomyLevel> = {
  read: 2, // observing, analysing and recommending change nothing
  internal_write: 4, // writes an internal record that is not trivially reversible: a person approves
  internal_reversible: 5, // the one class that may ever run unattended
  customer_send: 4, // L3 draft or L4 execute-after-approval: NEVER automatic
  ad_spend: 4, // a person approves every spend change
};

export const ACTION_TYPES = {
  summarise_page: { class: "read" as ActionClass, label: "Summarise a page from CRM facts" },
  answer_question: { class: "read" as ActionClass, label: "Answer a management question from read-only tools" },
  suggest_talking_points: { class: "read" as ActionClass, label: "Suggest RM talking points from facts on screen (read-only; nothing is sent, the RM decides)" },
  judge_text: { class: "read" as ActionClass, label: "Judge a drafted message for compliance" },
  extract_insights: { class: "internal_reversible" as ActionClass, label: "Extract insights from a conversation into the intelligence record (advisory rows, dismissable)" },
  analyse_conversation: { class: "internal_reversible" as ActionClass, label: "Score a call or chat for quality audit (re-runnable)" },
  propose_internal_record: { class: "internal_write" as ActionClass, label: "Propose an internal record (memory item, task) that a person accepts" },
  draft_customer_message: { class: "customer_send" as ActionClass, label: "Draft a message to a customer (a person approves and sends)" },
  suggest_reply: { class: "customer_send" as ActionClass, label: "Suggest a reply in the inbox (the RM edits and sends)" },
  draft_ad_copy: { class: "customer_send" as ActionClass, label: "Draft a creative brief or ad copy for a channel (compliance reviews and approves; nothing is published or placed)" },
  draft_public_post: { class: "customer_send" as ActionClass, label: "Draft a public social post (compliance approves)" },
  change_ad_spend: { class: "ad_spend" as ActionClass, label: "Change ad spend (a person approves)" },
  retry_failed_sync: { class: "internal_reversible" as ActionClass, label: "Retry a failed idempotent sync" },
} satisfies Record<string, { class: ActionClass; label: string }>;
export type ActionTypeId = keyof typeof ACTION_TYPES;
export const isActionType = (id: string): id is ActionTypeId => id in ACTION_TYPES;

export class AutonomyCeilingError extends Error {
  constructor(readonly actionType: string, readonly requested: number, readonly ceiling: number) {
    super(`Autonomy ceiling: ${actionType} cannot be set to L${requested}; its ceiling is L${ceiling}.`);
    this.name = "AutonomyCeilingError";
  }
}
export class AutonomyApprovalRequiredError extends Error {
  constructor(readonly actionType: string, detail: string) {
    super(`Autonomy: ${actionType} ${detail}`);
    this.name = "AutonomyApprovalRequiredError";
  }
}

export const ceilingForAction = (actionType: string): AutonomyLevel => {
  if (!isActionType(actionType)) throw new Error(`Unknown action type "${actionType}"`);
  return CEILING[ACTION_TYPES[actionType].class];
};

/** Throws when `level` is not a valid level or is above the action's ceiling. */
export function assertWithinCeiling(actionType: string, level: number): asserts level is AutonomyLevel {
  if (!Number.isInteger(level) || level < 0 || level > 5) throw new AutonomyCeilingError(actionType, level, 5);
  const ceiling = ceilingForAction(actionType);
  if (level > ceiling) throw new AutonomyCeilingError(actionType, level, ceiling);
}

/** The level actually in force: the stored one (or the registry default), never above the agent's own maximum or the ceiling. */
export function effectiveLevel(entry: { defaultLevel: AutonomyLevel; maxLevel: AutonomyLevel }, actionType: string, stored: number | null | undefined): AutonomyLevel {
  const wanted = stored ?? entry.defaultLevel;
  return Math.min(wanted, entry.maxLevel, ceilingForAction(actionType)) as AutonomyLevel;
}

/**
 * Called by the code that is about to EXECUTE an agent's action. Below L4 nothing executes (the agent only drafts or advises).
 * A customer send or an ad-spend change needs L4 and a human approval reference. L5 runs unattended only for an internal reversible action.
 */
export function assertMayExecute(input: { actionType: string; level: number; approvalRef?: string | null }): void {
  assertWithinCeiling(input.actionType, input.level);
  const cls = ACTION_TYPES[input.actionType as ActionTypeId].class;
  if (input.level < 4) throw new AutonomyApprovalRequiredError(input.actionType, `is at L${input.level}: it may draft or advise, not execute.`);
  if (input.level === 5) return; // only reachable for internal_reversible (the ceiling above)
  if (cls === "internal_reversible" && input.level === 4 && !input.approvalRef) throw new AutonomyApprovalRequiredError(input.actionType, "at L4 needs a human approval reference.");
  if (!input.approvalRef) throw new AutonomyApprovalRequiredError(input.actionType, "needs a human approval reference before it executes: customer sends and ad-spend changes are never automatic.");
}
