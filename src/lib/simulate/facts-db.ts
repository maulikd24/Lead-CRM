import { prisma } from "@/lib/db/prisma";

import type { TargetFacts } from "./engine";

const CONTACT_TYPES = ["CALL", "CONTACT", "MESSAGE", "MEETING"] as const;
const D = 86_400_000;

/**
 * Loads what simulate() needs for a set of customers the CALLER has already scoped to the viewer. Reads booleans, dates and consent rows;
 * never a phone number, an email address, a message or a conversation. One query per fact, not per customer.
 */
export async function loadTargetFacts(clientIds: string[], now: Date, windows: { recentContactHours: number; windowDays: number }): Promise<TargetFacts[]> {
  if (clientIds.length === 0) return [];
  const since = new Date(now.getTime() - Math.max(windows.windowDays * D, windows.recentContactHours * 3_600_000));
  const windowStart = now.getTime() - windows.windowDays * D;
  const [clients, consent, activities, insights] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: clientIds }, isDeleted: false }, select: { id: true, name: true, mobile: true, email: true, marketingConsentAt: true } }),
    prisma.consentRecord.findMany({ where: { clientId: { in: clientIds } }, select: { id: true, clientId: true, purpose: true, channel: true, status: true, capturedAt: true, expiresAt: true } }),
    prisma.activity.findMany({ where: { clientId: { in: clientIds }, type: { in: [...CONTACT_TYPES] }, createdAt: { gte: since } }, select: { clientId: true, createdAt: true }, take: 20000 }),
    prisma.conversationInsight.findMany({
      where: { clientId: { in: clientIds }, OR: [{ kind: "COMPLAINT", OR: [{ status: "OPEN" }, { occurredAt: { gte: new Date(now.getTime() - 14 * D) } }] }, { kind: "COMPLIANCE_CONCERN", status: "OPEN" }] },
      select: { clientId: true, kind: true },
    }),
  ]);
  const consentBy = new Map<string, typeof consent>();
  for (const c of consent) (consentBy.get(c.clientId) ?? consentBy.set(c.clientId, []).get(c.clientId)!).push(c);
  const last = new Map<string, Date>();
  const inWindow = new Map<string, number>();
  for (const a of activities) {
    if (!last.has(a.clientId) || a.createdAt > last.get(a.clientId)!) last.set(a.clientId, a.createdAt);
    if (a.createdAt.getTime() >= windowStart) inWindow.set(a.clientId, (inWindow.get(a.clientId) ?? 0) + 1);
  }
  const complaint = new Set(insights.filter((i) => i.kind === "COMPLAINT").map((i) => i.clientId));
  const compliance = new Set(insights.filter((i) => i.kind === "COMPLIANCE_CONCERN").map((i) => i.clientId));
  return clients.map((c) => ({
    id: c.id,
    label: c.name,
    consent: consentBy.get(c.id) ?? [],
    legacyMarketingConsentAt: c.marketingConsentAt,
    lastContactAt: last.get(c.id) ?? null,
    contactsInWindow: inWindow.get(c.id) ?? 0,
    openComplaint: complaint.has(c.id),
    complianceConcern: compliance.has(c.id),
    hasMobile: !!c.mobile,
    hasEmail: !!c.email,
  }));
}
