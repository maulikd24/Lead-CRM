import type { ApprovalActionType, ApprovalDecisionOptions } from "../../registry";
import type { Actor, ApprovalAdapter, CanonicalApproval, DecideInput, Evidence, LegacyOutcome, SubjectRef } from "../contract";
import { defaultCorrelation, refOf } from "../contract";
import { definitionOf, mayApprove, mayRequest } from "../definitions";
import { AUTONOMY_LEVELS, type AutonomyLevel } from "../autonomy";
import { NATIVE_KINDS, type NativeKind } from "../native";
import { effectiveState, type CanonicalState } from "../state";
import { failure, personOf, states } from "./shared";

/**
 * Kinds whose record IS an ApprovalRequest: payout runs, commission adjustments, erasure requests, partner tax and override rule
 * changes and stage corrections. The generic service (policy/approvals/service.ts) is already the single place that decides and
 * applies them, so this adapter only maps the row to the canonical view and calls `decideApproval` unchanged. It adds no table and
 * mirrors nothing: for these kinds the legacy record already carries requester, decider, time, note, expiry and (now) the chain.
 */
export type RequestRow = {
  id: string; actionType: string; entity: string; entityId: string; status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED"; payload: unknown; reason: string | null;
  requestedById: string; requestedByName: string | null; requestedAt: Date; decidedById: string | null; decidedAt: Date | null; decisionNote: string | null;
  expiresAt: Date | null; appliedAt: Date | null; correlationId: string | null; causationId: string | null; autonomyLevel: string | null;
};

/** Plain facts a loader fetches for one kind (a payout run's period and totals). Nothing personal. */
export type RequestFacts = { period?: string; payouts?: number; totalNet?: string } | null;

export type DecideFn = (id: string, decision: "APPROVED" | "REJECTED", note: string | undefined, actor: { id: string; role: Actor["role"] }, options?: ApprovalDecisionOptions) => Promise<void>;

export type RequestAdapterDeps = {
  kind: NativeKind;
  decide: DecideFn;
  loadAwaiting: (actionType: ApprovalActionType, limit: number) => Promise<RequestRow[]>;
  loadRequestedBy: (actionType: ApprovalActionType, userId: string, limit: number) => Promise<RequestRow[]>;
  loadRow: (id: string) => Promise<RequestRow | null>;
  loadFacts?: (kind: NativeKind, row: RequestRow) => Promise<RequestFacts>;
  markExpired?: (id: string) => Promise<void>;
};

const STATUS: Record<RequestRow["status"], CanonicalState> = { PENDING: "requested", APPROVED: "approved", REJECTED: "rejected", CANCELLED: "cancelled", EXPIRED: "expired" };
const inr = (n: number) => `${n < 0 ? "-" : ""}₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n))}`;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const push = (list: Evidence[], key: string, label: string, value: string | null) => { if (value) list.push({ key, label, value }); };

function describe(kind: NativeKind, r: RequestRow, facts: RequestFacts): { subject: SubjectRef; evidence: Evidence[]; summary: string } {
  const p = obj(r.payload);
  const ev: Evidence[] = [];
  const subjectType = definitionOf(kind).subjectType;
  let href: string | null = null;
  let label = subjectType;
  let summary: string | null = null;
  switch (kind) {
    case "payout-run":
      href = str(p.payoutRunId) ? `/earnings/runs/${str(p.payoutRunId)}` : "/earnings";
      push(ev, "period", "Pay period", facts?.period ?? null);
      push(ev, "payouts", "Payouts in the run", facts?.payouts !== undefined ? String(facts.payouts) : null);
      push(ev, "total", "Net payable", facts?.totalNet ?? null);
      label = facts?.period ? `Payout run, ${facts.period}` : "Payout run";
      summary = facts?.period ? `Approve the partner payout run for ${facts.period}${facts.payouts !== undefined && facts.totalNet ? `: ${facts.payouts} ${facts.payouts === 1 ? "payout" : "payouts"}, ${facts.totalNet} net.` : "."}` : "Approve this partner payout run.";
      break;
    case "commission-adjustment":
      href = "/earnings";
      push(ev, "amount", "Adjustment", typeof p.amount === "number" ? inr(p.amount) : null);
      push(ev, "reason", "Reason", str(p.reason) ?? r.reason);
      label = "Commission adjustment";
      summary = `Adjust one payout by ${typeof p.amount === "number" ? inr(p.amount) : "an amount"}${str(p.reason) ?? r.reason ? `: ${str(p.reason) ?? r.reason}` : ""}`;
      break;
    case "erasure-request":
      href = "/settings/data-privacy";
      push(ev, "subject", "Reason given", r.reason ?? "No reason recorded");
      label = "Data erasure request";
      summary = "Mark this erasure request approved. The data is deleted in a separate step by an Admin.";
      break;
    case "partner-tax-rule":
    case "partner-override-rule":
      href = "/settings/partner-finance?tab=approve";
      push(ev, "change", "Proposed change", r.reason ?? str(p.op));
      label = definitionOf(kind).label;
      summary = r.reason ?? label;
      break;
    case "stage-override":
      href = str(p.clientId) ? `/clients/${str(p.clientId)}` : null;
      push(ev, "reason", "Reason", str(p.reason) ?? r.reason);
      label = "Stage correction";
      summary = `Move a customer to a different stage${str(p.reason) ?? r.reason ? `: ${str(p.reason) ?? r.reason}` : ""}`;
      break;
  }
  return { subject: { type: subjectType, id: r.entityId, label, href }, evidence: ev, summary: summary ?? `${label}${r.reason ? `: ${r.reason}` : ""}` };
}

const level = (v: string | null): AutonomyLevel => ((AUTONOMY_LEVELS as readonly string[]).includes(v ?? "") ? (v as AutonomyLevel) : definitionOf("payout-run").autonomy.level);

export function toCanonicalRequest(kind: NativeKind, r: RequestRow, now: Date, facts: RequestFacts): CanonicalApproval {
  const base = states(STATUS, r.status);
  const state = base === "approved" && r.appliedAt ? "executed" : effectiveState(base, r.expiresAt, now);
  const d = describe(kind, r, facts);
  return {
    ref: refOf(kind, r.id), kind, id: r.id, subject: d.subject, state, legacyState: r.status, summary: d.summary,
    requestedBy: personOf(r.requestedById, r.requestedByName), requestedAt: r.requestedAt,
    approver: personOf(r.decidedById), decidedAt: r.decidedAt, decisionReason: r.decisionNote, expiresAt: r.expiresAt,
    evidence: d.evidence, correlationId: r.correlationId ?? defaultCorrelation(kind, r.id), causationId: r.causationId,
    autonomy: r.autonomyLevel ? level(r.autonomyLevel) : definitionOf(kind).autonomy.level,
    fourEyesAuthorId: r.requestedById, clientId: null,
  };
}

const RULES = [
  [/Maker cannot also be checker/i, "SELF_APPROVAL"], [/expired/i, "EXPIRED"], [/already/i, "ALREADY_DECIDED"], [/Not authorized/i, "FORBIDDEN"], [/not found/i, "NOT_FOUND"],
] as const;

export function createApprovalRequestAdapter(deps: RequestAdapterDeps): ApprovalAdapter {
  const { kind } = deps;
  const actionType = NATIVE_KINDS[kind] as ApprovalActionType;
  const view = async (r: RequestRow, now: Date) => toCanonicalRequest(kind, r, now, deps.loadFacts ? await deps.loadFacts(kind, r).catch(() => null) : null);
  return {
    kind,
    async listAwaiting(actor, now, limit) {
      if (!mayApprove(actor.role, kind)) return [];
      return Promise.all((await deps.loadAwaiting(actionType, limit)).map((r) => view(r, now)));
    },
    async listRequestedBy(actor, now, limit) {
      if (!mayRequest(actor.role, kind)) return [];
      return Promise.all((await deps.loadRequestedBy(actionType, actor.id, limit)).map((r) => view(r, now)));
    },
    async get(id, actor, now) {
      const r = await deps.loadRow(id);
      if (!r || r.actionType !== actionType) return null;
      if (!mayApprove(actor.role, kind) && !(mayRequest(actor.role, kind) && r.requestedById === actor.id)) return null;
      return view(r, now);
    },
    async decide(input: DecideInput): Promise<LegacyOutcome> {
      const holdOverrideReason = typeof input.params.holdOverrideReason === "string" ? input.params.holdOverrideReason.trim().slice(0, 500) : "";
      try {
        await deps.decide(input.subjectId, input.decision === "approve" ? "APPROVED" : "REJECTED", input.reason ?? undefined, { id: input.actor.id, role: input.actor.role }, holdOverrideReason ? { holdOverrideReason } : undefined);
        return { ok: true };
      } catch (error) {
        if (error instanceof Error && error.name === "ApprovalBlockedError") return failure(error.message, [[/./, "BLOCKED"]], (error as Error & { reasons?: string[] }).reasons);
        if (error instanceof Error) {
          const mapped = failure(error.message, RULES);
          // An unexpected failure (a database error inside apply) never leaks its text to the screen.
          return mapped.ok === false && mapped.code === "ERROR" ? { ok: false, code: "ERROR", error: "That could not be completed. Nothing further was changed." } : mapped;
        }
        return { ok: false, code: "ERROR", error: "That could not be completed." };
      }
    },
    async expire(id) {
      await deps.markExpired?.(id);
    },
  };
}
