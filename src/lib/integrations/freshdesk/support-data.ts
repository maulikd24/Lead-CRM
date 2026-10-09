import { prisma } from "@/lib/db/prisma";

import { toTicketView, type HandoffTicketView, type SupportRow } from "./ticket-view";

const WINDOW_DAYS = 90;
const MAX_ROWS = 500;

/** Base URL for links out to Freshdesk, from the integration's (non-secret) settings, e.g. https://acme.freshdesk.com. */
export async function getFreshdeskBaseUrl(): Promise<string | null> {
  const cfg = await prisma.integrationConfig.findUnique({ where: { provider: "freshdesk" }, select: { settings: true } });
  const url = (cfg?.settings as Record<string, unknown> | null)?.baseUrl;
  return typeof url === "string" ? url : null;
}

const HANDOFF_WHERE = { type: "TICKET" as const, payload: { path: ["handoff"], equals: true } };

/** Hand-offs on one customer, newest first (for the customer page). */
export async function loadClientHandoffs(clientId: string): Promise<HandoffTicketView[]> {
  const [rows, baseUrl] = await Promise.all([
    prisma.activity.findMany({ where: { clientId, ...HANDOFF_WHERE }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, payload: true } }),
    getFreshdeskBaseUrl(),
  ]);
  return rows.map((r) => toTicketView(r.payload, r.id, baseUrl)).filter((v): v is HandoffTicketView => v !== null);
}

/** Hand-offs for the manager view. `visibleRmIds` null = everyone (admin). */
export async function loadSupportRows(visibleRmIds: string[] | null, now: Date): Promise<SupportRow[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const [acts, baseUrl] = await Promise.all([
    prisma.activity.findMany({
      where: { ...HANDOFF_WHERE, createdAt: { gte: since }, ...(visibleRmIds ? { client: { assignedToId: { in: visibleRmIds } } } : {}) },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: { id: true, payload: true, clientId: true, client: { select: { name: true, assignedToId: true, assignedTo: { select: { name: true } } } } },
    }),
    getFreshdeskBaseUrl(),
  ]);
  const sources = acts.map((a) => `freshdesk-handoff:${(a.payload as { ticketId?: string }).ticketId}`);
  const tasks = sources.length
    ? await prisma.task.findMany({ where: { source: { in: sources } }, select: { clientId: true, source: true, status: true, updatedAt: true } })
    : [];
  const taskKey = (clientId: string, source: string) => `${clientId}|${source}`;
  const byKey = new Map(tasks.map((t) => [taskKey(t.clientId, t.source ?? ""), t]));

  const rows: SupportRow[] = [];
  for (const a of acts) {
    const view = toTicketView(a.payload, a.id, baseUrl);
    if (!view) continue;
    const task = byKey.get(taskKey(a.clientId, `freshdesk-handoff:${view.ticketId}`));
    const done = task?.status === "DONE";
    rows.push({ view, clientName: a.client.name, rmId: a.client.assignedToId, rmName: a.client.assignedTo?.name ?? null, taskDone: done, taskDoneAt: done ? task!.updatedAt : null });
  }
  return rows;
}
