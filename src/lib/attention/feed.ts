import { getVisibleUserIds } from "@/lib/auth/visibility";
import { prisma } from "@/lib/db/prisma";

import { allowedKinds, buildFeed, itemKey, validateDismissal, type AttentionItem, type Feed, type Scope } from "./engine";
import { loadCandidates, loadWorkloads, type ExtraSource } from "./sources";

/** The Attention feed for one signed-in person: sources, workloads, their own dismissals, then the pure ranker. */

export type FeedView = Feed & { sourceErrors: string[]; ownerNames: Record<string, string>; teamLoad: { userId: string; name: string; openWorkload: number; deferred: number }[] };

export async function scopeFor(userId: string, role: string): Promise<Scope> {
  return { userId, role, visibleUserIds: await getVisibleUserIds(userId, role as Parameters<typeof getVisibleUserIds>[1]) };
}

async function activeDismissals(userId: string, now: Date) {
  const rows = await prisma.attentionDismissal.findMany({ where: { userId, OR: [{ status: "DISMISSED" }, { status: "SNOOZED", snoozeUntil: { gt: now } }] }, select: { itemKey: true, status: true, snoozeUntil: true } });
  return rows.map((r) => ({ itemKey: r.itemKey, status: r.status as "DISMISSED" | "SNOOZED", snoozeUntil: r.snoozeUntil }));
}

export async function loadAttentionFeed(userId: string, role: string, now: Date = new Date(), opts: { ignoreDismissals?: boolean; extraSources?: readonly ExtraSource[] } = {}): Promise<FeedView> {
  if (allowedKinds(role).length === 0) return { items: [], capacity: {}, hiddenByDismissal: 0, label: "", version: "", sourceErrors: [], ownerNames: {}, teamLoad: [] };
  const scope = await scopeFor(userId, role);
  const { candidates, errors } = await loadCandidates(scope, now, opts.extraSources);
  const owners = [...new Set(candidates.map((c) => c.ownerUserId).filter((o): o is string => o !== null))];
  const [capacities, dismissals, users] = await Promise.all([
    loadWorkloads(owners),
    opts.ignoreDismissals ? Promise.resolve([]) : activeDismissals(userId, now),
    owners.length > 0 ? prisma.user.findMany({ where: { id: { in: owners } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const feed = buildFeed(candidates, { now, scope, dismissals, capacities });
  const ownerNames = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const teamLoad = role === "RM" ? [] : Object.entries(feed.capacity).filter(([, c]) => c.overloaded || c.deferred > 0).map(([id, c]) => ({ userId: id, name: ownerNames[id] ?? "Unknown", openWorkload: c.openWorkload, deferred: c.deferred })).sort((a, b) => b.openWorkload - a.openWorkload);
  return { ...feed, sourceErrors: errors, ownerNames, teamLoad };
}

export type DismissResult = { ok: true } | { ok: false; error: string };

/** Dismiss or snooze one item for this person. The item must be in their own feed right now (so a made-up id does nothing), and the override rules apply. Audited. */
export async function setDismissal(a: { userId: string; role: string; itemId: string; status: "DISMISSED" | "SNOOZED"; snoozeUntil: Date | null; reason: string | null; now?: Date; extraSources?: readonly ExtraSource[] }): Promise<DismissResult> {
  const now = a.now ?? new Date();
  const feed = await loadAttentionFeed(a.userId, a.role, now, { ignoreDismissals: true, extraSources: a.extraSources });
  const item: AttentionItem | undefined = feed.items.find((i) => i.id === a.itemId);
  if (!item) return { ok: false, error: "That item is not in your list any more." };
  const v = validateDismissal({ override: item.override, status: a.status, snoozeUntil: a.snoozeUntil, reason: a.reason, now });
  if (!v.ok) return v;
  const reason = a.reason?.trim().slice(0, 300) || null;
  await prisma.$transaction([
    prisma.attentionDismissal.upsert({
      where: { userId_itemKey: { userId: a.userId, itemKey: a.itemId } },
      create: { userId: a.userId, itemKey: a.itemId, kind: item.kind, status: a.status, snoozeUntil: a.status === "SNOOZED" ? a.snoozeUntil : null, reason },
      update: { status: a.status, snoozeUntil: a.status === "SNOOZED" ? a.snoozeUntil : null, reason },
    }),
    prisma.auditLog.create({ data: { userId: a.userId, entity: "AttentionItem", entityId: a.itemId, action: a.status === "DISMISSED" ? "attention.dismissed" : "attention.snoozed", newValue: { kind: item.kind, override: item.override, until: a.snoozeUntil?.toISOString() ?? null }, reason } }),
  ]);
  return { ok: true };
}

/** Undo: bring an item back. Always allowed for the person's own dismissal. Audited. */
export async function restoreItem(userId: string, itemId: string): Promise<DismissResult> {
  const existing = await prisma.attentionDismissal.findUnique({ where: { userId_itemKey: { userId, itemKey: itemId } }, select: { id: true } });
  if (!existing) return { ok: false, error: "Nothing to restore." };
  await prisma.$transaction([
    prisma.attentionDismissal.delete({ where: { id: existing.id } }),
    prisma.auditLog.create({ data: { userId, entity: "AttentionItem", entityId: itemId, action: "attention.restored" } }),
  ]);
  return { ok: true };
}

export { itemKey };
