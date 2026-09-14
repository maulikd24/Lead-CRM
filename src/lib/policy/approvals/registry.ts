import type { Actor } from "../types";

export type ApprovalActionType =
  | "STAGE_OVERRIDE"
  | "BULK_REASSIGN"
  | "CLIENT_MERGE"
  | "PARTNER_TIER_CHANGE"
  | "COMMISSION_ADJUSTMENT"
  | "PAYOUT_ADJUSTMENT"
  | "ERASURE_REQUEST";

export type ApprovalDefinition<TPayload = unknown> = {
  actionType: ApprovalActionType;
  entity: string;
  canRequest: (actor: Actor) => boolean;
  /** requester != decider is re-checked again in service.ts as a hard guard regardless of this. */
  canDecide: (actor: Actor) => boolean;
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
