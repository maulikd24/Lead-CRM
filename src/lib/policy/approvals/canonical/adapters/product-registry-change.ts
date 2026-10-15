import type { ReviewItem } from "@/lib/registry/service";

import type { Actor, ApprovalAdapter, CanonicalApproval, DecideInput, LegacyOutcome } from "../contract";
import { defaultCorrelation, refOf } from "../contract";
import { failure, personOf } from "./shared";

/**
 * Product registry change (four-eyes review of a product version). The legacy path is the registry's own `decideVersion`
 * (lib/registry/service.ts, rules in lifecycle.ts): Admin only, a version must be IN_REVIEW, and the AUTHOR may not approve their own
 * version. This adapter exposes the IN_REVIEW versions to the one approvals inbox and calls that path unchanged; the registry stays
 * authoritative and the registry screens keep working. The canonical service refuses the author first (fourEyesAuthorId), the registry
 * refuses them again: two independent checks. An approval changes what agents may cite; it never contacts a customer.
 */
export type RegistryChangeRow = ReviewItem & { state: "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "SUPERSEDED" | string };

export type RegistryAdapterDeps = {
  loadAwaiting: (limit: number) => Promise<RegistryChangeRow[]>;
  loadRow: (versionId: string) => Promise<RegistryChangeRow | null>;
  decide: (versionId: string, decision: "approve" | "reject", note: string | null, actor: { userId: string; role: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
};

const label = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** undefined = this version is not in an approval (a draft nobody has submitted). */
export function toCanonicalRegistryChange(row: RegistryChangeRow): CanonicalApproval | undefined {
  const state = row.state === "IN_REVIEW" ? "requested" : row.state === "APPROVED" || row.state === "SUPERSEDED" ? "approved" : row.state === "REJECTED" ? "rejected" : null;
  if (!state) return undefined;
  const first = row.versionNo === 1;
  return {
    ref: refOf("product-registry-change", row.versionId), kind: "product-registry-change", id: row.versionId,
    subject: { type: "Product registry entry", id: row.productId, label: row.productName, href: "/settings/product-registry" },
    state, legacyState: row.state,
    summary: `${first ? "New product" : `Change to ${row.productName}`}: version ${row.versionNo} of ${row.productName}${row.isExample ? " (an EXAMPLE entry: it can never be cited in production)" : ""}`,
    requestedBy: personOf(row.createdById), requestedAt: row.submittedAt ?? new Date(0),
    approver: personOf(row.reviewedById), decidedAt: row.reviewedAt, decisionReason: state === "rejected" ? row.reviewNote : null, expiresAt: null,
    evidence: [
      { key: "change", label: "What is being approved", value: `${row.productName}, version ${row.versionNo}, ${label(row.category)}, availability ${label(row.availability)}` },
      { key: "risk", label: "Risk category", value: label(row.riskCategory) },
      { key: "claims", label: "Marketing claims in this version", value: String(row.claimCount) },
      { key: "product-status", label: "Product status now", value: label(row.productStatus) },
    ],
    correlationId: defaultCorrelation("product-registry-change", row.versionId), causationId: null, autonomy: "L4",
    // The registry's own rule: whoever wrote the version cannot approve it.
    fourEyesAuthorId: row.createdById, clientId: null,
  };
}

const RULES = [
  [/author cannot approve/i, "SELF_APPROVAL"], [/Only an Admin/i, "FORBIDDEN"], [/in review can be decided/i, "ALREADY_DECIDED"], [/not found/i, "NOT_FOUND"], [/retired product cannot be changed/i, "BLOCKED"],
] as const;

export function createProductRegistryChangeAdapter(deps: RegistryAdapterDeps): ApprovalAdapter {
  const views = (rows: RegistryChangeRow[]) => rows.map((r) => toCanonicalRegistryChange(r)).filter((v): v is CanonicalApproval => !!v);
  const allowed = (actor: Actor) => actor.role === "ADMIN";
  return {
    kind: "product-registry-change",
    async listAwaiting(actor, _now, limit) {
      return allowed(actor) ? views(await deps.loadAwaiting(limit)).filter((v) => v.state === "requested") : [];
    },
    async listRequestedBy() {
      return []; // the registry screens are where an Admin sees what they submitted
    },
    async get(id, actor) {
      if (!allowed(actor)) return null;
      const row = await deps.loadRow(id);
      return row ? (toCanonicalRegistryChange(row) ?? null) : null;
    },
    async decide(input: DecideInput): Promise<LegacyOutcome> {
      const res = await deps.decide(input.subjectId, input.decision, input.reason, { userId: input.actor.id, role: input.actor.role as string });
      return res.ok ? { ok: true } : failure(res.error, RULES);
    },
  };
}
