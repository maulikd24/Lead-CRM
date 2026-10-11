import { can } from "@/lib/access/policy";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { prisma } from "@/lib/db/prisma";
import { authoriseService, type Viewer } from "@/lib/memory/access";

import { buildListRows, buildServiceFacts, buildServiceStrip, type CommitmentRow, type ComplaintRow, type ServiceFacts, type ServiceStrip } from "./view";

const complaintSelect = { id: true, clientId: true, title: true, severity: true, status: true, ownerId: true, openedAt: true, acknowledgedAt: true, slaDueAt: true, resolvedAt: true, closedAt: true, reopenedCount: true, taskId: true, supportTicketId: true, insightId: true, reviewId: true, updatedAt: true } as const;
const commitmentSelect = { id: true, clientId: true, text: true, dueAt: true, status: true, promisedByType: true, promisedById: true, promisedToType: true, ownerId: true, confirmedAt: true, keptAt: true, taskId: true, insightId: true } as const;

export type ComplaintCandidate = { kind: "insight" | "ticket"; id: string; label: string; severity: string | null };
export type ServiceState = ServiceStrip & { asOf: Date; canManage: boolean; candidates: ComplaintCandidate[]; /** Names for the owners shown (id to name). */ people: Record<string, string> };

const COMPLAINT_WORDS = ["complain", "grievance", "escalat"];

/** Things that look like a complaint but have not been registered as one: a COMPLAINT insight, a ticket whose subject says so. Offered, never auto-registered. */
async function loadCandidates(clientId: string): Promise<ComplaintCandidate[]> {
  const [insights, tickets, linked] = await Promise.all([
    prisma.conversationInsight.findMany({ where: { clientId, kind: "COMPLAINT", status: "OPEN" }, orderBy: { occurredAt: "desc" }, take: 5, select: { id: true, text: true, severity: true } }),
    prisma.supportTicket.findMany({ where: { clientId, OR: COMPLAINT_WORDS.map((w) => ({ subject: { contains: w, mode: "insensitive" as const } })) }, orderBy: { ticketCreatedAt: "desc" }, take: 5, select: { id: true, subject: true } }),
    prisma.complaint.findMany({ where: { clientId }, select: { insightId: true, supportTicketId: true }, take: 200 }),
  ]);
  const insightIds = new Set(linked.map((l) => l.insightId).filter(Boolean));
  const ticketIds = new Set(linked.map((l) => l.supportTicketId).filter(Boolean));
  return [
    ...insights.filter((i) => !insightIds.has(i.id)).map((i) => ({ kind: "insight" as const, id: i.id, label: i.text.slice(0, 120), severity: i.severity })),
    ...tickets.filter((t) => !ticketIds.has(t.id)).map((t) => ({ kind: "ticket" as const, id: t.id, label: (t.subject ?? "Ticket").slice(0, 120), severity: null })),
  ];
}

/** The Service strip for one customer. Authorised here (registry area plus the customer's record scope); null means "not found". */
export async function getServiceState(viewer: Viewer, clientId: string, now: Date = new Date()): Promise<ServiceState | null> {
  const auth = await authoriseService(viewer, clientId);
  if (!auth.ok) return null;
  const [complaints, commitments, candidates] = await Promise.all([
    prisma.complaint.findMany({ where: { clientId, OR: [{ status: { in: ["OPEN", "IN_PROGRESS", "REOPENED"] } }, { resolvedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } }] }, orderBy: { openedAt: "desc" }, take: 50, select: complaintSelect }),
    prisma.commitment.findMany({ where: { clientId, status: "OPEN" }, orderBy: { dueAt: "asc" }, take: 50, select: commitmentSelect }),
    auth.canManage ? loadCandidates(clientId) : Promise.resolve([]),
  ]);
  const strip = buildServiceStrip(complaints, commitments, now);
  const ownerIds = [...new Set([...strip.complaints.map((c) => c.ownerId), ...strip.commitments.map((c) => c.ownerId)].filter((x): x is string => !!x))];
  const users = ownerIds.length ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : [];
  return { ...strip, asOf: now, canManage: auth.canManage, candidates, people: Object.fromEntries(users.map((u) => [u.id, u.name])) };
}

export type ServiceQueueRow<T> = T & { clientName: string; clientCode: string };

/**
 * The RM / manager list: open complaints and overdue commitments across the customers the viewer may see (RM own, manager team,
 * admin all). Role and scope are checked here; MARKETING and every other role get nothing.
 */
export async function getServiceQueue(viewer: Viewer, now: Date = new Date()) {
  if (!can(viewer.role, "service-state", "view")) return null;
  const visible = await getVisibleUserIds(viewer.userId, viewer.role as Parameters<typeof getVisibleUserIds>[1]);
  const clientWhere = { mergedIntoId: null, isDeleted: false, ...(visible ? { assignedToId: { in: visible } } : {}) };
  const [complaints, commitments] = await Promise.all([
    prisma.complaint.findMany({ where: { status: { in: ["OPEN", "IN_PROGRESS", "REOPENED"] }, client: clientWhere }, orderBy: { slaDueAt: "asc" }, take: 200, select: { ...complaintSelect, client: { select: { name: true, clientCode: true } } } }),
    prisma.commitment.findMany({ where: { status: "OPEN", confirmedAt: { not: null }, dueAt: { lt: now }, client: clientWhere }, orderBy: { dueAt: "asc" }, take: 200, select: { ...commitmentSelect, client: { select: { name: true, clientCode: true } } } }),
  ]);
  const names = new Map<string, { name: string; code: string }>();
  for (const r of [...complaints, ...commitments]) names.set(r.clientId, { name: r.client.name, code: r.client.clientCode });
  const rows = buildListRows(complaints as ComplaintRow[], commitments as CommitmentRow[], now);
  const tag = <T extends { clientId: string }>(r: T): ServiceQueueRow<T> => ({ ...r, clientName: names.get(r.clientId)?.name ?? "", clientCode: names.get(r.clientId)?.code ?? "" });
  return { asOf: now, complaints: rows.complaints.map(tag), commitments: rows.commitments.map(tag), canManage: can(viewer.role, "service-state", "manage") };
}

/**
 * The read API for other modules (decision engine suppression, attention engine): facts only, one or many customers. The caller
 * has already authorised the customers. Carries counts, the highest severity and an as-of; never a title, text or name.
 */
export async function getServiceFacts(clientId: string, now: Date = new Date()): Promise<ServiceFacts> {
  const m = await getServiceFactsMany([clientId], now);
  return m.get(clientId)!;
}

export async function getServiceFactsMany(clientIds: readonly string[], now: Date = new Date()): Promise<Map<string, ServiceFacts>> {
  const out = new Map<string, ServiceFacts>();
  if (clientIds.length === 0) return out;
  const [complaints, commitments] = await Promise.all([
    prisma.complaint.findMany({ where: { clientId: { in: [...clientIds] }, status: { in: ["OPEN", "IN_PROGRESS", "REOPENED"] } }, select: complaintSelect, take: 5000 }),
    prisma.commitment.findMany({ where: { clientId: { in: [...clientIds] }, status: "OPEN", confirmedAt: { not: null } }, select: commitmentSelect, take: 5000 }),
  ]);
  for (const id of clientIds) out.set(id, buildServiceFacts(complaints.filter((c) => c.clientId === id), commitments.filter((m) => m.clientId === id), now));
  return out;
}
