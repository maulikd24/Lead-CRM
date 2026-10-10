import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { getVisibleScope } from "@/lib/policy/visibility";
import type { Role } from "@/generated/prisma/client";
import { isPartnerWorkspaceEnabled } from "./flag";
import { NATIVE_ROLES, resolveNativeScope, type PartnerScope, type ScopeDb } from "./native/scope";
import { resolvePartnerSource, type PartnerSource } from "./source";
import { FUNNEL_FILTERS, KYC_FILTERS, PAYOUT_FILTERS, type ListQuery } from "./view-models";

/** Who may open the workspace when it shows the made-up sample data: the whole programme, admin and finance only. */
export const PARTNER_WORKSPACE_ROLES: Role[] = ["ADMIN", "FINANCE"];

type Session = Awaited<ReturnType<typeof requireRole>>;
export type PartnerAccess = { session: Session; role: Role; source: PartnerSource; scope: PartnerScope };

/**
 * Every Partner workspace page starts here: a 404 when the flag is off (nothing is revealed), then the role check, then
 * the set of partners this person may see. With the native source that is admin and finance (everyone), a partner user
 * (their own sub-tree), a team manager (what the existing hierarchy rules give). With an external or sample source it
 * is admin and finance only, as before.
 */
export async function requirePartnerWorkspace(): Promise<PartnerAccess> {
  if (!isPartnerWorkspaceEnabled()) notFound();
  const source = resolvePartnerSource();
  if (source !== "native") {
    const session = await requireRole(PARTNER_WORKSPACE_ROLES);
    return { session, role: session.user.role, source, scope: { kind: "all" } };
  }
  const session = await requireRole(NATIVE_ROLES);
  const scope = await resolveNativeScope({ id: session.user.id, role: session.user.role }, { db: prisma as unknown as ScopeDb, visibleScope: getVisibleScope });
  if (!scope) notFound(); // unreachable for a role that passed the check; fail closed anyway
  return { session, role: session.user.role, source, scope };
}

/** For pages that exist only in the native workspace (network, commissions, statements): a 404 under any other source. */
export async function requireNativePartnerWorkspace(): Promise<PartnerAccess> {
  if (!isPartnerWorkspaceEnabled() || resolvePartnerSource() !== "native") notFound();
  return requirePartnerWorkspace();
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Reads list filters from the URL, accepting only known values so nothing arbitrary reaches the API. */
export function parseListQuery(sp: Record<string, string | string[] | undefined>): ListQuery {
  const q = first(sp.q)?.trim().slice(0, 80) || undefined;
  const kycRaw = first(sp.kyc);
  const funnelRaw = first(sp.funnel);
  const statusRaw = first(sp.status);
  const offsetNum = Number.parseInt(first(sp.offset) ?? "0", 10);
  return {
    q,
    kyc: KYC_FILTERS.some((f) => f.key === kycRaw && f.key !== "all") ? kycRaw : undefined,
    funnel: FUNNEL_FILTERS.includes(funnelRaw ?? "") && funnelRaw !== "all" ? funnelRaw : undefined,
    status: PAYOUT_FILTERS.includes(statusRaw ?? "") && statusRaw !== "all" ? statusRaw : undefined,
    offset: Number.isFinite(offsetNum) && offsetNum > 0 ? Math.min(offsetNum, 100000) : 0,
  };
}
