"use server";

import { revalidatePath } from "next/cache";

import type { Priority } from "@/generated/prisma/client";
import { logActivity } from "@/lib/activities/log-activity";
import { requireAccess } from "@/lib/auth/require-role";
import { assertClientInScope } from "@/lib/clients/load-in-scope";
import { SAVED_VIEW_SCOPE, SAVED_VIEWS_PER_USER, canonicalViewQuery, cleanViewName } from "@/lib/clients/views";
import { prisma } from "@/lib/db/prisma";

/**
 * The /clients workspace's own actions: a person's saved views (theirs alone; saving needs only the right to open the list) and the
 * inline priority edit (manage on clients, and only for a client in the caller's scope: an RM their own, a Manager their team's).
 */
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type SavedViewRow = { id: string; name: string; query: string };

export async function listClientViewsAction(): Promise<SavedViewRow[]> {
  const session = await requireAccess("clients");
  return prisma.savedView.findMany({ where: { userId: session.user.id, scope: SAVED_VIEW_SCOPE }, orderBy: { name: "asc" }, select: { id: true, name: true, query: true } });
}

/** Saves the current filters under a name; the same name again replaces it. */
export async function saveClientViewAction(name: unknown, query: unknown): Promise<ActionResult<{ view: SavedViewRow }>> {
  const session = await requireAccess("clients");
  const clean = cleanViewName(name);
  if (!clean) return { ok: false, error: "Give the view a name of at least 2 characters." };
  const q = canonicalViewQuery(new URLSearchParams(typeof query === "string" ? query : ""));
  const where = { userId: session.user.id, scope: SAVED_VIEW_SCOPE };
  const exists = await prisma.savedView.findFirst({ where: { ...where, name: clean }, select: { id: true } });
  if (!exists && (await prisma.savedView.count({ where })) >= SAVED_VIEWS_PER_USER) return { ok: false, error: `You can keep up to ${SAVED_VIEWS_PER_USER} views. Delete one first.` };
  const view = await prisma.savedView.upsert({
    where: { userId_scope_name: { ...where, name: clean } },
    create: { ...where, name: clean, query: q },
    update: { query: q },
    select: { id: true, name: true, query: true },
  });
  return { ok: true, view };
}

export async function deleteClientViewAction(id: unknown): Promise<ActionResult> {
  const session = await requireAccess("clients");
  if (typeof id !== "string") return { ok: false, error: "That view no longer exists." };
  // deleteMany scoped to the owner: someone else's view id deletes nothing.
  const { count } = await prisma.savedView.deleteMany({ where: { id, userId: session.user.id, scope: SAVED_VIEW_SCOPE } });
  return count ? { ok: true } : { ok: false, error: "That view no longer exists." };
}

const PRIORITIES: readonly Priority[] = ["LOW", "MEDIUM", "HIGH"];

export async function setClientPriorityAction(clientId: unknown, priority: unknown): Promise<ActionResult<{ previous: Priority }>> {
  const session = await requireAccess("clients", "manage");
  if (typeof clientId !== "string" || !PRIORITIES.includes(priority as Priority)) return { ok: false, error: "That priority is not valid." };
  try {
    await assertClientInScope(session.user, clientId);
  } catch {
    return { ok: false, error: "Client not found." };
  }
  const before = await prisma.client.findFirst({ where: { id: clientId, isDeleted: false }, select: { priority: true } });
  if (!before) return { ok: false, error: "Client not found." };
  const next = priority as Priority;
  if (before.priority === next) return { ok: true, previous: before.priority };
  await prisma.$transaction([
    prisma.client.update({ where: { id: clientId }, data: { priority: next } }),
    prisma.auditLog.create({ data: { userId: session.user.id, entity: "Client", entityId: clientId, action: "priority_changed", oldValue: { priority: before.priority }, newValue: { priority: next } } }),
  ]);
  await logActivity({ clientId, userId: session.user.id, type: "NOTE", payload: { message: `Priority set to ${next.toLowerCase()}` } });
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, previous: before.priority };
}
