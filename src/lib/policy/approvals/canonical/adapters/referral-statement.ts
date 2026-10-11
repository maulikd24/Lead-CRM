import { approveStatement } from "@/lib/referrals/statements";
import type { ReferralStore, StatementRow } from "@/lib/referrals/store";

import type { Actor, ApprovalAdapter, CanonicalApproval, DecideInput, LegacyOutcome } from "../contract";
import { defaultCorrelation, refOf } from "../contract";
import { failure, personOf, states } from "./shared";

/**
 * RewardStatement (referral rewards). The legacy path is referrals/statements.ts `approveStatement`: Admin or Finance, never the person
 * who prepared it, refused when a line changed since it was prepared, one compare-and-set on PREPARED -> APPROVED that also writes the
 * ledger rows. "Paid" stays a separate step with a bank reference and is not an approval. The legacy path has no reject: a wrong
 * statement is prepared again, so this adapter declares reject unsupported rather than inventing one.
 */
export type StatementView = StatementRow & { referrerLabel: string | null; preparedAt: Date; approvedAt: Date | null; preparerName: string | null };

export type StatementAdapterDeps = {
  store: ReferralStore;
  /** The referral programme switch: with it off the legacy actions refuse everything, so nothing is listed. */
  enabled: () => boolean;
  loadAwaiting: (limit: number) => Promise<StatementView[]>;
  loadPreparedBy: (userId: string, limit: number) => Promise<StatementView[]>;
  loadView: (id: string) => Promise<StatementView | null>;
};

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const mayDecide = (actor: Actor) => actor.role === "ADMIN" || actor.role === "FINANCE";

export function toCanonicalStatement(s: StatementView, _now: Date): CanonicalApproval {
  const months = [...new Set(s.lines.map((l) => l.periodMonth))].sort().join(", ");
  const label = `${s.referrerLabel ?? "Referrer"} · ${s.period}`;
  return {
    ref: refOf("referral-statement", s.id), kind: "referral-statement", id: s.id,
    subject: { type: "Reward statement", id: s.id, label, href: "/referrals?tab=statements" },
    state: states({ PREPARED: "requested", APPROVED: "approved", PAID: "executed" }, s.status),
    legacyState: s.status,
    summary: `Reward statement ${label}, ${rupees(s.totalPaise)}`,
    requestedBy: personOf(s.preparedById, s.preparerName), requestedAt: s.preparedAt,
    approver: personOf(s.approvedById), decidedAt: s.approvedAt, decisionReason: null, expiresAt: null,
    evidence: [
      { key: "total", label: "Total to pay", value: rupees(s.totalPaise) },
      { key: "lines", label: "Rewards on it", value: `${s.lines.length} ${s.lines.length === 1 ? "reward" : "rewards"}, ${months}` },
      { key: "period", label: "Statement month", value: s.period },
    ],
    correlationId: defaultCorrelation("referral-statement", s.id), causationId: null, autonomy: "L4",
    fourEyesAuthorId: s.preparedById, clientId: null,
  };
}

const RULES = [
  [/second pair of eyes/i, "SELF_APPROVAL"], [/Only Admin or Finance/i, "FORBIDDEN"], [/Only a prepared statement|already moved/i, "ALREADY_DECIDED"],
  [/changed after it was prepared|nothing to pay/i, "BLOCKED"], [/does not exist/i, "NOT_FOUND"],
] as const;

export function createReferralStatementAdapter(deps: StatementAdapterDeps): ApprovalAdapter {
  return {
    kind: "referral-statement",
    async listAwaiting(actor, now, limit) {
      return deps.enabled() && mayDecide(actor) ? (await deps.loadAwaiting(limit)).map((s) => toCanonicalStatement(s, now)) : [];
    },
    async listRequestedBy(actor, now, limit) {
      return deps.enabled() && mayDecide(actor) ? (await deps.loadPreparedBy(actor.id, limit)).map((s) => toCanonicalStatement(s, now)) : [];
    },
    async get(id, actor, now) {
      if (!deps.enabled() || !mayDecide(actor)) return null;
      const s = await deps.loadView(id);
      return s ? toCanonicalStatement(s, now) : null;
    },
    async decide(input: DecideInput): Promise<LegacyOutcome> {
      if (input.decision !== "approve") return { ok: false, code: "UNSUPPORTED", error: "A statement is prepared again, not rejected." };
      const res = await approveStatement({ store: deps.store, actor: { id: input.actor.id, role: input.actor.role as string }, statementId: input.subjectId });
      return res.ok ? { ok: true } : failure(res.error, RULES);
    },
  };
}
