import type { Role } from "@/generated/prisma/client";

/**
 * Who may open the native Partner workspace, and which partners each of them may see.
 * `ids` are the partners whose counts and totals are visible. `detailIds` are the partners whose customer-level lines
 * (customer codes, individual accruals, statement lines) are visible too: a partner's own profile only, nobody for a team manager.
 */
export type PartnerScope = { kind: "all" } | { kind: "ids"; ids: string[]; detailIds: string[] };

const ALL_ROLES: Role[] = ["ADMIN", "FINANCE"];
const PARTNER_ROLES: Role[] = ["PARTNER", "AFFILIATE", "DISTRIBUTOR"];
/** Admin and Finance see everything; a partner user their own sub-tree; a team manager what the existing hierarchy rules give. Everyone else: no access. */
export const NATIVE_ROLES: Role[] = [...ALL_ROLES, "TEAM_MANAGER", ...PARTNER_ROLES];

export const nativeRoleAllowed = (role: Role): boolean => NATIVE_ROLES.includes(role);

export type ScopeDb = {
  partnerProfile: {
    findUnique(a: { where: { userId: string }; select: { id: true } }): Promise<{ id: string } | null>;
    findMany(a: { where: { parentPartnerProfileId: { in: string[] } }; select: { id: true } }): Promise<{ id: string }[]>;
  };
};
type VisibleScope = (userId: string, role: Role) => Promise<{ partnerProfileIds: string[] | null }>;

/** Upper bound on one person's sub-tree, so a runaway roll-up cannot turn into an unbounded query. */
export const MAX_SCOPE_PARTNERS = 5000;

/**
 * Resolves the partners a signed-in user may see, from the role and (for a partner user) their own profile and its
 * roll-up below. Fails closed: no profile, or no assigned partners, is an empty scope, never everything.
 */
export async function resolveNativeScope(
  actor: { id: string; role: Role },
  deps: { db: ScopeDb; visibleScope: VisibleScope },
): Promise<PartnerScope | null> {
  if (ALL_ROLES.includes(actor.role)) return { kind: "all" };

  if (actor.role === "TEAM_MANAGER") {
    const v = await deps.visibleScope(actor.id, actor.role);
    return { kind: "ids", ids: v.partnerProfileIds ?? [], detailIds: [] };
  }

  if (PARTNER_ROLES.includes(actor.role)) {
    const own = await deps.db.partnerProfile.findUnique({ where: { userId: actor.id }, select: { id: true } });
    if (!own) return { kind: "ids", ids: [], detailIds: [] };
    const seen = new Set<string>([own.id]);
    let frontier = [own.id];
    while (frontier.length && seen.size < MAX_SCOPE_PARTNERS) {
      const kids = await deps.db.partnerProfile.findMany({ where: { parentPartnerProfileId: { in: frontier } }, select: { id: true } });
      frontier = [];
      for (const k of kids) {
        if (!seen.has(k.id)) {
          seen.add(k.id);
          frontier.push(k.id);
        }
      }
    }
    return { kind: "ids", ids: [...seen], detailIds: [own.id] };
  }

  return null;
}

export function scopeAllows(scope: PartnerScope, partnerProfileId: string): boolean {
  return scope.kind === "all" || scope.ids.includes(partnerProfileId);
}

/** A Prisma string filter for a partner id column: undefined for everyone, `{ in }` otherwise. */
export function scopeFilter(scope: PartnerScope): { in: string[] } | undefined {
  return scope.kind === "all" ? undefined : { in: scope.ids };
}

/** Whether the viewer may see customer-level lines for this partner. Never beyond the scope itself. */
export function detailAllows(scope: PartnerScope, partnerProfileId: string): boolean {
  return scope.kind === "all" || (scope.detailIds.includes(partnerProfileId) && scope.ids.includes(partnerProfileId));
}

/** A Prisma filter for line-level queries: undefined for everyone, `{ in }` the partners whose lines the viewer may see otherwise. */
export function detailFilter(scope: PartnerScope): { in: string[] } | undefined {
  return scope.kind === "all" ? undefined : { in: scope.detailIds.filter((id) => scope.ids.includes(id)) };
}
