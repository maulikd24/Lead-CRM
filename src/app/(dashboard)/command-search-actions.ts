"use server";

import { prisma } from "@/lib/db/prisma";
import { requireAccess, requireUser } from "@/lib/auth/require-role";
import { enabledNavFlags } from "@/lib/nav-flags";
import { universalSearch, type SearchDeps, type SearchHit } from "@/lib/palette/universal-search";
import { searchCampaignNames } from "@/lib/marketing/campaign-search";
import { taskScopeFor } from "@/lib/access/own-tasks";
import { getVisibleScope } from "@/lib/policy/visibility";
import { resolveNativeScope, scopeFilter, type ScopeDb } from "@/lib/partners/native/scope";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { maskMobile } from "@/lib/privacy/contact-mask";

export type PaletteClientResult = {
  id: string;
  name: string;
  clientCode: string;
  mobile: string | null;
  // Present when this result surfaced via a joint holder's name/mobile rather than the account's
  // own — the palette still navigates to the parent account (there's no standalone holder page).
  matchedHolder?: { name: string; position: string | null };
};

export async function searchClientsForPalette(query: string): Promise<PaletteClientResult[]> {
  const session = await requireAccess("clients", "view");
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const assignedToFilter = visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {};

  const [clients, holderMatches] = await Promise.all([
    prisma.client.findMany({
      where: {
        ...assignedToFilter,
        OR: [
          { name: { contains: trimmed, mode: "insensitive" } },
          { clientCode: { contains: trimmed, mode: "insensitive" } },
          { mobile: { contains: trimmed } },
        ],
      },
      select: { id: true, name: true, clientCode: true, mobile: true },
      take: 8,
    }),
    prisma.accountHolder.findMany({
      where: {
        isDeleted: false,
        client: assignedToFilter,
        OR: [
          { name: { contains: trimmed, mode: "insensitive" } },
          { mobile: { contains: trimmed } },
        ],
      },
      select: { name: true, position: true, client: { select: { id: true, name: true, clientCode: true, mobile: true } } },
      take: 8,
    }),
  ]);

  const seenClientIds = new Set(clients.map((c) => c.id));
  const holderResults: PaletteClientResult[] = holderMatches
    .filter((h) => !seenClientIds.has(h.client.id))
    .map((h) => ({ ...h.client, matchedHolder: { name: h.name, position: h.position } }));

  // Matching still runs on the raw number on the server; only the masked form is returned.
  return [...clients, ...holderResults].slice(0, 8).map((r) => ({ ...r, mobile: maskMobile(r.mobile) }));
}

const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });

/** The sources behind Cmd+K. Every query here receives the scope the matching page uses; universalSearch decides, from the policy registry, which of them run at all. */
const searchDeps: SearchDeps = {
  visibleUserIds: (actor) => getVisibleUserIds(actor.id, actor.role),
  partnerScope: (actor) => resolveNativeScope(actor, { db: prisma as unknown as ScopeDb, visibleScope: getVisibleScope }),
  customers: async (q, visible) => {
    const assignedToFilter = visible ? { assignedToId: { in: visible } } : {};
    return prisma.client.findMany({
      where: { ...assignedToFilter, isDeleted: false, OR: [{ name: contains(q) }, { clientCode: contains(q) }, { mobile: { contains: q } }] },
      select: { id: true, name: true, clientCode: true, mobile: true },
      take: 4,
    });
  },
  tasks: async (q, actor, visible) => {
    const rows = await prisma.task.findMany({
      where: { ...(taskScopeFor(actor.role, actor.id, visible) ?? {}), title: contains(q), client: { isDeleted: false } },
      select: { id: true, title: true, status: true, dueAt: true, client: { select: { id: true, name: true } } },
      orderBy: { dueAt: "asc" },
      take: 4,
    });
    return rows.map((t) => ({ id: t.id, title: t.title, status: t.status, dueAt: t.dueAt, clientId: t.client.id, clientName: t.client.name }));
  },
  tickets: async (q, visible) => {
    const rows = await prisma.supportTicket.findMany({
      where: { subject: contains(q), client: { isDeleted: false, ...(visible ? { assignedToId: { in: visible } } : {}) } },
      select: { id: true, subject: true, client: { select: { id: true, name: true } } },
      orderBy: { ticketCreatedAt: "desc" },
      take: 4,
    });
    return rows.map((t) => ({ id: t.id, subject: t.subject, clientId: t.client.id, clientName: t.client.name }));
  },
  partners: async (q, scope) => {
    const rows = await prisma.partnerProfile.findMany({
      where: { id: scopeFilter(scope), OR: [{ partnerCode: contains(q) }, { user: { name: contains(q) } }] },
      select: { id: true, partnerCode: true, user: { select: { name: true } } },
      take: 4,
    });
    return rows.map((p) => ({ id: p.id, code: p.partnerCode, name: p.user.name }));
  },
  campaigns: (q, actor) => searchCampaignNames(actor.role, q),
};

/** Cmd+K search across customers, tasks, tickets, partners and campaigns. Open to every signed-in role: what comes back is decided by the policy registry and each source's own scope. */
export async function universalSearchAction(query: string): Promise<SearchHit[]> {
  const session = await requireUser();
  return universalSearch({ id: session.user.id, role: session.user.role }, query, enabledNavFlags(), searchDeps);
}
