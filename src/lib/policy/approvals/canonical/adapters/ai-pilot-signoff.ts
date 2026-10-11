import { PILOT_STATEMENT, PILOT_STATEMENT_VERSION } from "@/lib/agents/pilot";
import { recordSignoff, type PilotDb } from "@/lib/agents/pilot-service";

import type { Actor, ApprovalAdapter, CanonicalApproval, DecideInput, LegacyOutcome } from "../contract";
import { defaultCorrelation, refOf } from "../contract";
import { failure, personOf } from "./shared";

/**
 * AiPilotSignoff (compliance sign-off of the reply assistant's wording). The legacy path is agents/pilot-service.ts `recordSignoff`:
 * Admin only, an explicit tick against the CURRENT wording version, one immutable row, audited. There is no reject (a sign-off is
 * revoked later, which is a different act) and the legacy rule lets one Admin sign alone, so this definition declares no four-eyes
 * rather than invent one (see docs/approvals.md, open question). The approval is "requested" while someone is on the pilot list and
 * the current wording is unsigned; the handle is the wording version, so an old version can never be signed.
 */
export type PilotFacts = {
  listedUsers: number;
  firstListedAt: Date | null;
  firstListedById: string | null;
  signoff: { statementVersion: string; acknowledgedById: string; acknowledgedAt: Date } | null;
};

export type PilotAdapterDeps = { db: PilotDb; loadFacts: () => Promise<PilotFacts> };

/** undefined = nothing to sign (nobody is on the pilot list yet). */
export function toCanonicalSignoff(f: PilotFacts, now: Date): CanonicalApproval | undefined {
  const signed = !!f.signoff && f.signoff.statementVersion === PILOT_STATEMENT_VERSION;
  if (!signed && f.listedUsers === 0) return undefined;
  return {
    ref: refOf("ai-pilot-signoff", PILOT_STATEMENT_VERSION), kind: "ai-pilot-signoff", id: PILOT_STATEMENT_VERSION,
    subject: { type: "Pilot wording", id: PILOT_STATEMENT_VERSION, label: `Reply assistant pilot wording ${PILOT_STATEMENT_VERSION}`, href: "/settings/ai-pilot" },
    state: signed ? "approved" : "requested",
    legacyState: signed ? "SIGNED" : "UNSIGNED",
    summary: "Compliance sign-off for the reply assistant pilot",
    requestedBy: personOf(f.firstListedById), requestedAt: f.firstListedAt ?? now,
    approver: signed ? personOf(f.signoff!.acknowledgedById) : null, decidedAt: signed ? f.signoff!.acknowledgedAt : null, decisionReason: null, expiresAt: null,
    evidence: [
      { key: "statement", label: "The wording to sign", value: PILOT_STATEMENT.join("\n") },
      { key: "version", label: "Wording version", value: PILOT_STATEMENT_VERSION },
      { key: "people", label: "People on the pilot list", value: String(f.listedUsers) },
    ],
    correlationId: defaultCorrelation("ai-pilot-signoff", PILOT_STATEMENT_VERSION), causationId: null, autonomy: "L4", fourEyesAuthorId: null, clientId: null,
  };
}

const RULES = [[/Only an Admin/i, "FORBIDDEN"], [/Tick the box/i, "NEEDS_INPUT"], [/wording has changed/i, "BLOCKED"]] as const;
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
