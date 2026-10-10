import type { Actor } from "../types";

export type ApprovalActionType =
  | "STAGE_OVERRIDE"
  | "BULK_REASSIGN"
  | "CLIENT_MERGE"
  | "PARTNER_TIER_CHANGE"
  | "COMMISSION_ADJUSTMENT"
  | "PAYOUT_ADJUSTMENT"
  | "ERASURE_REQUEST"
  | "PARTNER_TAX_RULE_CHANGE"
  | "PARTNER_OVERRIDE_RULE_CHANGE";

/** Extra input a decision may carry. holdOverrideReason lets an Admin approve a payout run that the hold rules would block. */
export type ApprovalDecisionOptions = { holdOverrideReason?: string };

export type ApprovalDefinition<TPayload = unknown> = {
  actionType: ApprovalActionType;
  entity: string;
  canRequest: (actor: Actor) => boolean;
  /** requester != decider is re-checked again in service.ts as a hard guard regardless of this. */
  canDecide: (actor: Actor) => boolean;
  /** Runs before an APPROVAL is recorded (never before a rejection). Throw to leave the request pending, e.g. ApprovalBlockedError. */
  precheck?: (payload: TPayload, ctx: { actor: Actor; options?: ApprovalDecisionOptions }) => Promise<void>;
  /** Executes the real side effect once approved. Must be idempotent. */
  apply: (payload: TPayload, ctx: { approvalRequestId: string; decidedById: string }) => Promise<void>;
};

const REGISTRY = new Map<ApprovalActionType, ApprovalDefinition<unknown>>();

export function registerApproval<T>(def: ApprovalDefinition<T>) {
  REGISTRY.set(def.actionType, def as ApprovalDefinition<unknown>);
}

export function getApprovalDefinition(actionType: ApprovalActionType): ApprovalDefinition<unknown> {
  const def = REGISTRY.get(actionType);
  if (!def) throw new Error(`No ApprovalDefinition registered for "${actionType}"`);
  return def;
}
