import { decideDismiss, decideMerge, type DecideCode, type DecideDeps } from "@/lib/identity/merge-review/decide";
import type { SideView } from "@/lib/identity/merge-review/rm-scope";

import type { ApprovalAdapter, CanonicalApproval, DecideInput, FailureCode, LegacyOutcome } from "../contract";
import { defaultCorrelation, refOf } from "../contract";
import { personOf, states } from "./shared";

/**
 * MergeSuggestion (possible duplicate customers). The legacy path is identity/merge-review/decide.ts: role (Admin, Manager, RM), the
 * RM's own-customers scope, rate limits, and a compare-and-set OPEN -> MERGED or DISMISSED. "Approve" means MERGE, which is
 * irreversible and needs a chosen survivor and an explicit confirmation, so the inbox does not do it in place: it opens the pair.
 * "Reject" means DISMISS and works in place. The adapter's own approve exists for the day a flow supplies both inputs.
 */
export type MergeRow = {
  id: string; status: string; score: number; percent: number; label: string; reasons: string[];
  a: SideView; b: SideView; restricted: boolean; createdAt: Date; decidedAt: Date | null;
};

export type MergeAdapterDeps = {
  legacy: DecideDeps;
  /** The duplicate-review switch: off means the legacy actions refuse everything. */
  enabled: () => boolean;
  /** Open pairs this person may decide (the loader applies the owner-scope rule, restricted pairs excluded). */
  loadAwaiting: (actor: { id: string; role: string }, limit: number) => Promise<MergeRow[]>;
  /** One pair as this person may see it, in any status; null for a restricted or invisible pair. */
  loadRow: (id: string, actor: { id: string; role: string }) => Promise<MergeRow | null>;
};

const REVIEWERS = ["ADMIN", "MANAGER", "RM"];
const side = (s: SideView) => (s.code ? `${s.first} (${s.code})` : s.first);

export function toCanonicalMerge(r: MergeRow): CanonicalApproval {
  return {
    ref: refOf("merge-suggestion", r.id), kind: "merge-suggestion", id: r.id,
    subject: { type: "Duplicate pair", id: r.id, label: `${side(r.a)} and ${side(r.b)}`, href: `/clients/duplicates?item=${r.id}` },
    state: states({ OPEN: "requested", MERGED: "executed", DISMISSED: "rejected" }, r.status),
    legacyState: r.status,
    summary: `Possible duplicate: ${side(r.a)} and ${side(r.b)}`,
    requestedBy: null, requestedAt: r.createdAt, approver: personOf(null), decidedAt: r.decidedAt, decisionReason: null, expiresAt: null,
    evidence: [
      { key: "reasons", label: "Why they look alike", value: r.reasons.join("; ") },
      { key: "score", label: "Match", value: `${r.percent}% (${r.label})` },
    ],
    correlationId: defaultCorrelation("merge-suggestion", r.id), causationId: null, autonomy: "L4", fourEyesAuthorId: null, clientId: null,
  };
}

const CODE: Record<DecideCode, FailureCode> = { FORBIDDEN: "FORBIDDEN", INVALID: "INVALID", RATE_LIMITED: "BLOCKED", NOT_FOUND: "NOT_FOUND", STALE: "ALREADY_DECIDED", OUT_OF_SCOPE: "NOT_FOUND", BLOCKED: "BLOCKED", ERROR: "ERROR" };

export function createMergeSuggestionAdapter(deps: MergeAdapterDeps): ApprovalAdapter {
  return {
    kind: "merge-suggestion",
    async listAwaiting(actor, now, limit) {
      return deps.enabled() && REVIEWERS.includes(actor.role) ? (await deps.loadAwaiting(actor, limit)).filter((r) => r.status === "OPEN" && !r.restricted).map((r) => toCanonicalMerge(r)) : [];
    },
    async listRequestedBy() {
      return [];
    },
    async get(id, actor, now) {
      if (!deps.enabled() || !REVIEWERS.includes(actor.role)) return null;
      const r = await deps.loadRow(id, actor);
      return r && !r.restricted ? toCanonicalMerge(r) : null;
    },
    async decide(input: DecideInput): Promise<LegacyOutcome> {
      const actor = { id: input.actor.id, role: input.actor.role };
      const res = input.decision === "approve"
        ? await decideMerge(deps.legacy, actor, { suggestionId: input.subjectId, survivorId: input.params.survivorId, confirmed: input.params.confirmed })
        : await decideDismiss(deps.legacy, actor, { suggestionId: input.subjectId, reason: input.reason ?? undefined });
      return res.ok ? { ok: true } : { ok: false, code: CODE[res.code], error: res.error };
    },
  };
}
