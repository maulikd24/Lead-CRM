import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/require-role";
import type { Role } from "@/generated/prisma/client";
import { isPartnerWorkspaceEnabled } from "./flag";
import { FUNNEL_FILTERS, KYC_FILTERS, PAYOUT_FILTERS, type ListQuery } from "./view-models";

export const PARTNER_WORKSPACE_ROLES: Role[] = ["ADMIN", "FINANCE", "TEAM_MANAGER"];

/** Every Partner workspace page starts here: a 404 when the flag is off (nothing is revealed), otherwise the role check. */
export async function requirePartnerWorkspace() {
  if (!isPartnerWorkspaceEnabled()) notFound();
  return requireRole(PARTNER_WORKSPACE_ROLES);
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
