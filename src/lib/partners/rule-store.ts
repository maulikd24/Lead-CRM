import type { Actor } from "@/lib/policy/types";
import type { ApprovalActionType } from "@/lib/policy/approvals/registry";
import { ApprovalBlockedError } from "@/lib/policy/approvals/service";
import type { Dated, RuleChange, RulePlan } from "./rule-plan";

/**
 * The shared maker-checker mechanics for rule tables (tax rules, override rules): propose through the approval workflow, check
 * again just before approval, apply in one transaction with both people recorded, audit every step. Nothing is edited in place.
 */
type Delegate = {
  findMany(a?: { orderBy?: unknown }): Promise<unknown[]>;
  create(a: { data: Record<string, unknown> }): Promise<{ id: string }>;
  update(a: { where: { id: string }; data: { effectiveTo: Date } }): Promise<unknown>;
};
export type RuleStoreDb = {
  approvalRequest: { findUnique(a: { where: { id: string }; select: { requestedById: true } }): Promise<{ requestedById: string } | null> };
  auditLog: { create(a: { data: Record<string, unknown> }): Promise<unknown> };
  $transaction<T>(fn: (tx: never) => Promise<T>): Promise<T>;
};

export type RuleStoreConfig<R extends Dated, N extends Omit<R, "id">, Db extends RuleStoreDb> = {
  entity: string;
  actionType: ApprovalActionType;
  /** Audit actions are `<auditPrefix>_proposed`, `_created` and `_ended`. */
  auditPrefix: string;
  delegate: (db: Db) => Delegate;
  load: (db: Db) => Promise<R[]>;
  plan: (change: RuleChange, existing: R[], now: Date) => RulePlan<N>;
  /** The Prisma create data for a planned rule (without the approval fields). */
  createData: (rule: N) => Record<string, unknown>;
};

export type ProposeResult = { ok: true; requestId: string; summary: string } | { ok: false; errors: string[] };
type Requester = (type: ApprovalActionType, input: { entity: string; entityId: string; payload: unknown; reason?: string }, actor: Actor) => Promise<{ id: string }>;

export function createRuleStore<R extends Dated, N extends Omit<R, "id">, Db extends RuleStoreDb>(cfg: RuleStoreConfig<R, N, Db>) {
  const entityId = (c: RuleChange) => (c.op === "create" ? "new" : c.ruleId);

  async function propose(deps: { db: Db; request: Requester }, actor: Actor, change: RuleChange, now: Date): Promise<ProposeResult> {
    const plan = cfg.plan(change, await cfg.load(deps.db), now);
    if (!plan.ok) return { ok: false, errors: plan.errors };
    const req = await deps.request(cfg.actionType, { entity: cfg.entity, entityId: entityId(change), payload: change, reason: plan.summary }, actor);
    await deps.db.auditLog.create({ data: { userId: actor.id, entity: cfg.entity, entityId: entityId(change), action: `${cfg.auditPrefix}_proposed`, newValue: { requestId: req.id, change: change as unknown as object }, reason: plan.summary } });
    return { ok: true, requestId: req.id, summary: plan.summary };
  }

  /** The approval precheck: the change must still hold against today's rules, or the request stays pending. */
  async function check(db: Db, change: RuleChange, now: Date): Promise<void> {
    const plan = cfg.plan(change, await cfg.load(db), now);
    if (!plan.ok) throw new ApprovalBlockedError("This rule change can no longer be applied.", plan.errors);
  }

  async function apply(db: Db, change: RuleChange, ctx: { approvalRequestId: string; decidedById: string }, now: Date): Promise<void> {
    const request = await db.approvalRequest.findUnique({ where: { id: ctx.approvalRequestId }, select: { requestedById: true } });
    if (!request) throw new Error("Approval request not found");
    if (request.requestedById === ctx.decidedById) throw new Error("A rule change must be approved by a different person than the one who proposed it.");
    const plan = cfg.plan(change, await cfg.load(db), now);
    if (!plan.ok) throw new Error(plan.errors.join(" "));
    await db.$transaction(async (txNever) => {
      const tx = txNever as unknown as Db;
      const table = cfg.delegate(tx);
      for (const w of plan.writes) {
        if (w.type === "end") {
          await table.update({ where: { id: w.id }, data: { effectiveTo: new Date(w.effectiveTo) } });
          await tx.auditLog.create({ data: { userId: ctx.decidedById, entity: cfg.entity, entityId: w.id, action: `${cfg.auditPrefix}_ended`, newValue: { effectiveTo: w.effectiveTo, approvalRequestId: ctx.approvalRequestId }, reason: plan.summary } });
        } else {
          const created = await table.create({ data: { ...cfg.createData(w.data), approvalRequestId: ctx.approvalRequestId, createdById: request.requestedById, approvedById: ctx.decidedById } });
          await tx.auditLog.create({ data: { userId: ctx.decidedById, entity: cfg.entity, entityId: created.id, action: `${cfg.auditPrefix}_created`, newValue: { rule: w.data as unknown as object, proposedBy: request.requestedById, approvalRequestId: ctx.approvalRequestId }, reason: plan.summary } });
        }
      }
    });
  }

  return { propose, check, apply };
}
