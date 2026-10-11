import { PILOT_STATEMENT, PILOT_STATEMENT_VERSION, signoffProgress } from "@/lib/agents/pilot";
import { recordSignoff, type PilotDb } from "@/lib/agents/pilot-service";

import type { Actor, ApprovalAdapter, CanonicalApproval, DecideInput, LegacyOutcome } from "../contract";
import { defaultCorrelation, refOf } from "../contract";
import { failure, personOf } from "./shared";

/**
 * AiPilotSignoff (sign-off of the reply assistant's wording). The legacy path is agents/pilot-service.ts `recordSignoff`:
 * Admin only, an explicit tick against the CURRENT wording version, one immutable row per signature, audited. There is no reject (a
 * sign-off is revoked later, which is a different act).
 * FOUR-EYES (Wave 1, a permission tightening): two signatures from two different people are needed, a compliance reviewer first and a
 * DIFFERENT Admin second; only both unlock the pilot. While the second is missing the item stays "requested" and `fourEyesAuthorId`
 * is the first signer, so the canonical service refuses that person as a self-approval (the legacy action refuses it too).
 * The approval is "requested" while someone is on the pilot list and the current wording is not fully signed; the handle is the
 * wording version, so an old version can never be signed.
 */
export type PilotFacts = {
  listedUsers: number;
  firstListedAt: Date | null;
  firstListedById: string | null;
  /** Every active (not withdrawn) signature row, any wording version. */
  signoffs: { statementVersion: string; acknowledgedById: string; acknowledgedAt: Date }[];
};

export type PilotAdapterDeps = { db: PilotDb; loadFacts: () => Promise<PilotFacts> };

/** undefined = nothing to sign (nobody is on the pilot list yet). */
export function toCanonicalSignoff(f: PilotFacts, now: Date): CanonicalApproval | undefined {
  const progress = signoffProgress(f.signoffs);
  const signed = progress.complete;
  if (!signed && f.listedUsers === 0 && !progress.compliance) return undefined;
  const first = progress.compliance;
  const signatures = !first ? "none yet" : signed ? `compliance: ${first.acknowledgedById}; countersigned by a different Admin: ${progress.countersign!.acknowledgedById}` : `compliance: ${first.acknowledgedById}; a different Admin must countersign`;
  return {
    ref: refOf("ai-pilot-signoff", PILOT_STATEMENT_VERSION), kind: "ai-pilot-signoff", id: PILOT_STATEMENT_VERSION,
    subject: { type: "Pilot wording", id: PILOT_STATEMENT_VERSION, label: `Reply assistant pilot wording ${PILOT_STATEMENT_VERSION}`, href: "/settings/ai-pilot" },
    state: signed ? "approved" : "requested",
    legacyState: signed ? "SIGNED" : first ? "AWAITING_COUNTERSIGNATURE" : "UNSIGNED",
    summary: signed ? "Compliance sign-off and Admin countersignature recorded for the reply assistant pilot" : first ? "Compliance has signed the reply assistant pilot wording: a different Admin must countersign" : "Compliance sign-off for the reply assistant pilot (a different Admin countersigns)",
    requestedBy: personOf(f.firstListedById), requestedAt: f.firstListedAt ?? now,
    approver: signed ? personOf(progress.countersign!.acknowledgedById) : null, decidedAt: signed ? progress.countersign!.acknowledgedAt : null, decisionReason: null, expiresAt: null,
    evidence: [
      { key: "statement", label: "The wording to sign", value: PILOT_STATEMENT.join("\n") },
      { key: "version", label: "Wording version", value: PILOT_STATEMENT_VERSION },
      { key: "people", label: "People on the pilot list", value: String(f.listedUsers) },
      { key: "signatures", label: "Signatures (two different people)", value: signatures },
    ],
    correlationId: defaultCorrelation("ai-pilot-signoff", PILOT_STATEMENT_VERSION), causationId: null, autonomy: "L4", fourEyesAuthorId: !signed && first ? first.acknowledgedById : null, clientId: null,
  };
}

const RULES = [[/Only an Admin/i, "FORBIDDEN"], [/different Admin/i, "SELF_APPROVAL"], [/Tick the box/i, "NEEDS_INPUT"], [/wording has changed/i, "BLOCKED"]] as const;
const isAdmin = (a: Actor) => a.role === "ADMIN";

export function createAiPilotSignoffAdapter(deps: PilotAdapterDeps): ApprovalAdapter {
  return {
    kind: "ai-pilot-signoff",
    async listAwaiting(actor, now) {
      if (!isAdmin(actor)) return [];
      const v = toCanonicalSignoff(await deps.loadFacts(), now);
      return v && v.state === "requested" ? [v] : [];
    },
    async listRequestedBy() {
      return [];
    },
    async get(id, actor, now) {
      if (!isAdmin(actor) || id !== PILOT_STATEMENT_VERSION) return null;
      return toCanonicalSignoff(await deps.loadFacts(), now) ?? null;
    },
    async decide(input: DecideInput): Promise<LegacyOutcome> {
      if (input.decision !== "approve") return { ok: false, code: "UNSUPPORTED", error: "A sign-off is recorded or revoked, not rejected." };
      const res = await recordSignoff(deps.db, { id: input.actor.id, role: input.actor.role as string }, { confirmed: input.params.acknowledged === true, statementVersion: input.subjectId }, input.now);
      return res.ok ? { ok: true } : failure(res.error, RULES);
    },
  };
}
