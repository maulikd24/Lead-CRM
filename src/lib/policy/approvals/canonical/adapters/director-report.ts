import { can } from "@/lib/access/policy";

import type { Actor, ApprovalAdapter, CanonicalApproval, DecideInput, LegacyOutcome } from "../contract";
import { refOf } from "../contract";
import { clip, failure, personOf } from "./shared";

/**
 * Director report publication. Two legacy rows, one canonical kind, told apart by the id prefix:
 *   share:<id>   a report link. It is created awaiting approval and opens nothing until a person approves (decideShare); declining revokes it with a reason.
 *   digest:<id>  the weekly marketing digest draft. The system prepares it and never sends it; a person approves or discards it (approveDigest, discardDigest).
 * The adapter calls those legacy functions and decides no policy of its own. The report carries aggregate numbers only (scrubbed when the link is made).
 */
export type ShareRow = {
  type: "share"; id: string; label: string | null; periodFrom: Date; periodTo: Date; expiresAt: Date; createdAt: Date; createdById: string; createdByName: string | null;
  awaitingApproval: boolean; approvedAt: Date | null; approvedById: string | null; revokedAt: Date | null; decisionNote: string | null;
  /** The approval setting: a second person must approve a link. */
  fourEyes: boolean;
};
export type DigestRow = { type: "digest"; id: string; subject: string; bodyText: string; weekStart: Date; status: string; approvedById: string | null; approvedAt: Date | null; createdAt: Date };
export type ReportApprovalRow = ShareRow | DigestRow;

export type ReportLegacy = {
  decideShare(input: { id: string; actorId: string; decision: "approve" | "decline"; confirmed?: boolean; reason?: string; now?: Date }): Promise<{ ok: true; decision: "approve" | "decline" } | { ok: false; error: string }>;
  approveDigest(id: string, userId: string): Promise<boolean>;
  discardDigest(id: string, userId: string): Promise<boolean>;
};

export type ReportAdapterDeps = {
  legacy: ReportLegacy;
  now: () => Date;
  loadAwaiting: (limit: number) => Promise<ReportApprovalRow[]>;
  loadRequestedBy: (userId: string, limit: number) => Promise<ShareRow[]>;
  /** key is "share:<id>" or "digest:<id>". */
  loadRow: (key: string) => Promise<ReportApprovalRow | null>;
};

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const keyOf = (r: ReportApprovalRow) => `${r.type}:${r.id}`;
export const parseKey = (key: string): { type: "share" | "digest"; id: string } | null => {
  const m = /^(share|digest):([A-Za-z0-9_-]{1,64})$/.exec(key);
  return m ? { type: m[1] as "share" | "digest", id: m[2] } : null;
};

/** undefined = not in an approval. */
export function toCanonicalDirectorReport(row: ReportApprovalRow, now: Date): CanonicalApproval | undefined {
  const key = keyOf(row);
  if (row.type === "share") {
    const state = row.approvedAt ? "approved" : row.revokedAt ? "rejected" : row.awaitingApproval ? (now.getTime() >= row.expiresAt.getTime() ? "expired" : "requested") : null;
    if (!state) return undefined;
    const period = `${day(row.periodFrom)} to ${day(row.periodTo)}`;
    return {
      ref: refOf("director-report", key), kind: "director-report", id: key,
      subject: { type: "Director report", id: row.id, label: row.label?.trim() || `Report ${period}`, href: "/marketing?tab=reports" },
      state, legacyState: state === "approved" ? "LIVE" : state === "rejected" ? "DECLINED" : "PENDING",
      summary: `Report link for ${period}${row.label ? `: ${row.label}` : ""}`,
      requestedBy: personOf(row.createdById, row.createdByName), requestedAt: row.createdAt,
      approver: personOf(row.approvedById), decidedAt: row.approvedAt ?? row.revokedAt, decisionReason: state === "rejected" ? row.decisionNote : null,
      expiresAt: row.expiresAt,
      evidence: [{ key: "report", label: "Report", value: `Channel and campaign results for ${period}: spend, leads, funded customers and revenue. Aggregate numbers only; no customer is named. The link expires on ${day(row.expiresAt)}.` }],
      correlationId: `director-report:${key}`, causationId: null, autonomy: "L4",
      fourEyesAuthorId: row.fourEyes ? row.createdById : null, clientId: null,
    };
  }
  const state = row.status === "DRAFT" ? "requested" : row.status === "APPROVED" ? "approved" : row.status === "DISCARDED" ? "rejected" : null;
  if (!state) return undefined;
  return {
    ref: refOf("director-report", key), kind: "director-report", id: key,
    subject: { type: "Director report", id: row.id, label: row.subject, href: "/marketing?tab=reports" },
    state, legacyState: row.status,
    summary: `Weekly digest draft: ${row.subject}`,
    requestedBy: null, requestedAt: row.createdAt,
    approver: personOf(row.approvedById), decidedAt: row.approvedAt, decisionReason: null, expiresAt: null,
    evidence: [{ key: "report", label: "Draft email", value: clip(row.bodyText, 3000) }],
    correlationId: `director-report:${key}`, causationId: null, autonomy: "L4",
    // Prepared by the system job: there is no human author, so any approver may approve it. Nothing is sent by approving; a person sends the email.
    fourEyesAuthorId: null, clientId: null,
  };
}

const RULES = [
  [/second person/i, "SELF_APPROVAL"], [/no longer waiting|no longer a draft/i, "ALREADY_DECIDED"], [/no longer exists/i, "NOT_FOUND"],
  [/Tick the box/i, "NEEDS_INPUT"], [/Say why/i, "REASON_REQUIRED"],
] as const;

export function createDirectorReportAdapter(deps: ReportAdapterDeps): ApprovalAdapter {
  const views = (rows: ReportApprovalRow[]) => rows.map((r) => toCanonicalDirectorReport(r, deps.now())).filter((v): v is CanonicalApproval => !!v);
  const allowed = (actor: Actor) => can(actor.role, "marketing-reports", "export");
  return {
    kind: "director-report",
    async listAwaiting(actor, _now, limit) {
      return allowed(actor) ? views(await deps.loadAwaiting(limit)).filter((v) => v.state === "requested") : [];
    },
    async listRequestedBy(actor, _now, limit) {
      return allowed(actor) ? views(await deps.loadRequestedBy(actor.id, limit)) : [];
    },
    async get(id, actor) {
      if (!allowed(actor) || !parseKey(id)) return null;
      const row = await deps.loadRow(id);
      return row ? (toCanonicalDirectorReport(row, deps.now()) ?? null) : null;
    },
    async decide(input: DecideInput): Promise<LegacyOutcome> {
      const key = parseKey(input.subjectId);
      if (!key) return { ok: false, code: "NOT_FOUND", error: "That report no longer exists." };
      if (key.type === "share") {
        const res = await deps.legacy.decideShare({ id: key.id, actorId: input.actor.id, decision: input.decision === "approve" ? "approve" : "decline", confirmed: input.params.confirmed === true, reason: input.reason ?? "", now: input.now });
        return res.ok ? { ok: true } : failure(res.error, RULES);
      }
      const ok = input.decision === "approve" ? await deps.legacy.approveDigest(key.id, input.actor.id) : await deps.legacy.discardDigest(key.id, input.actor.id);
      return ok ? { ok: true } : failure("That digest is no longer a draft.", RULES);
    },
  };
}
