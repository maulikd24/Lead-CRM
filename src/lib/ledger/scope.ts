import { can } from "@/lib/access/policy";
import { canOpen360 } from "@/lib/clients/access";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { prisma } from "@/lib/db/prisma";
import { canSeeDecision } from "@/lib/intelligence/decision/access";
import { definitionOf, isKind } from "@/lib/policy/approvals/canonical/definitions";
import { nativeKindOf } from "@/lib/policy/approvals/canonical/native";
import type { Role } from "@/generated/prisma/client";

import type { LedgerViewer } from "./types";

/**
 * Role scoping for the Action Ledger. It reuses the central rules and adds none of its own:
 *  - who may open a customer: the Customer 360 rule (canOpen360: an RM their own customers, a manager their team, an admin all; not found otherwise),
 *  - who may see Decision Engine records: the decision rule (canSeeDecision: managers and admins, an RM only with NBA_RM_VISIBLE and only their own customers),
 *  - which approvals: per approval kind, from the canonical definitions (an approver or a requester of that kind, and an admin),
 *  - MARKETING: no customer at all; campaign-level aggregates with pseudonymous labels only (see read.ts).
 */

/** The canonical kind of an ApprovalRequest row: a native kind's registry key, or a write-through copy's `AGENT_PROPOSAL` style name. */
export function approvalKindOf(actionType: string): string | null {
  const native = nativeKindOf(actionType);
  if (native) return native;
  const k = actionType.toLowerCase().replace(/_/g, "-");
  return isKind(k) ? k : null;
}

/** May a viewer of this role see an approval of this action type? An unknown type is Admin only. Default deny. */
export function approvalVisibleTo(role: string, actionType: string): boolean {
  if (role === "ADMIN") return true;
  const kind = approvalKindOf(actionType);
  if (!kind || !isKind(kind)) return false;
  const def = definitionOf(kind);
  if (def.approverRoles.includes(role as Role)) return true;
  return Array.isArray(def.requesterRoles) && (def.requesterRoles as readonly string[]).includes(role);
}

export type ClientAccess = { ok: true; clientId: string; canSeeDecisions: boolean; assignedToId: string | null } | { ok: false; reason: "forbidden" | "not_found" };

export async function authoriseClient(viewer: LedgerViewer, clientId: string): Promise<{ access: ClientAccess; queries: number }> {
  if (!can(viewer.role, "action-ledger", "view")) return { access: { ok: false, reason: "forbidden" }, queries: 0 };
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { assignedToId: true, isDeleted: true, mergedIntoId: true } });
  if (!client) return { access: { ok: false, reason: "not_found" }, queries: 1 };
  const visible = await getVisibleUserIds(viewer.id, viewer.role as Role);
  const queries = viewer.role === "MANAGER" ? 2 : 1;
  // Same answer as a customer that does not exist: the ledger cannot be used to learn whose customer it is.
  if (!canOpen360(viewer.role, visible, client)) return { access: { ok: false, reason: "not_found" }, queries };
  return { access: { ok: true, clientId, assignedToId: client.assignedToId, canSeeDecisions: canSeeDecision(viewer, visible, client) }, queries };
}

/** Where a source record opens for this viewer, or null when no screen for it is open to the role. */
export function hrefFor(role: string): (table: string, id: string, clientId: string | null) => string | null {
  return (table, id, clientId) => {
    switch (table) {
      case "Message": return clientId && can(role, "inbox") ? `/inbox?client=${clientId}` : null;
      case "AgentProposal": return can(role, "agent-drafts") ? "/agents" : null;
      case "ApprovalRequest": return can(role, "action-ledger-investigate") ? `/settings/control-plane/investigate?by=approval&q=${encodeURIComponent(id)}` : can(role, "approvals") ? "/approvals" : null;
      case "Task": return can(role, "tasks") ? "/tasks" : null;
      case "Complaint": return clientId && can(role, "service-state") ? `/clients/${clientId}/360?tab=service` : null;
      case "ConsentRecord": return clientId && can(role, "client-360") ? `/clients/${clientId}/360?tab=consent` : null;
      case "DecisionRecord": return clientId && can(role, "decision-drawer") ? `/clients/${clientId}/360` : null;
      case "StageHistory": return clientId && can(role, "client-360") ? `/clients/${clientId}/360?tab=timeline` : null;
      case "AgentRun": return can(role, "action-ledger-investigate") ? `/settings/control-plane/investigate?by=run&q=${encodeURIComponent(id)}` : null;
      default: return null;
    }
  };
}
