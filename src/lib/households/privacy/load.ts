import { can } from "@/lib/access/policy";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { canViewClient } from "@/lib/clients/access";
import { prisma } from "@/lib/db/prisma";
import { latestPositionPerHolding } from "@/lib/households/latest-positions";
import { authoriseMemory, type Viewer } from "@/lib/memory/access";
import { getServiceFactsMany } from "@/lib/service/read";
import type { Prisma } from "@/generated/prisma/client";

import { CONSENTABLE_FACETS, facetVisible, validateConsentScopes, type ConsentRow } from "./policy";
import { buildHouseholdSummary, type Fetchers, type HouseholdSummary, type MemberInput } from "./summary";

/**
 * Household loaders. Every one decides first (registry area, then the viewer's record scope per member, then the privacy policy)
 * and only queries what that decision allows. They return null for "not found" and never say whether a household or member exists
 * to someone who may not see it.
 */

const POSITION_WINDOW_DAYS = 400;

const dbFetchers: Fetchers = {
  portfolio: async (ids) => {
    const since = new Date(Date.now() - POSITION_WINDOW_DAYS * 86_400_000);
    const out = new Map<string, { aum: number; accountCount: number; asOf: Date | null }>();
    const positions = await prisma.position.findMany({
      where: { tradingAccount: { clientId: { in: [...ids] } }, asOfDate: { gte: since } },
      select: { productId: true, tradingAccountId: true, asOfDate: true, quantity: true, currentValue: true, tradingAccount: { select: { clientId: true } } },
    });
    const latest = latestPositionPerHolding(positions).filter((p) => Number(p.quantity) > 0);
    for (const id of ids) {
      const mine = latest.filter((p) => p.tradingAccount.clientId === id);
      const asOf = mine.reduce<Date | null>((m, p) => (!m || p.asOfDate > m ? p.asOfDate : m), null);
      out.set(id, { aum: mine.reduce((s, p) => s + (p.currentValue ? Number(p.currentValue) : 0), 0), accountCount: new Set(mine.map((p) => p.tradingAccountId)).size, asOf });
    }
    return out;
  },
  service: async (ids) => {
    const facts = await getServiceFactsMany(ids);
    return new Map([...facts].map(([id, f]) => [id, { openComplaintCount: f.openComplaintCount, overdueCommitmentCount: f.overdueCommitmentCount, asOf: f.asOf }]));
  },
};

const toConsent = (r: { subjectClientId: string; granteeClientId: string | null; scopes: unknown; status: string; capturedAt: Date; expiresAt: Date | null }): ConsentRow => ({
  subjectClientId: r.subjectClientId, granteeClientId: r.granteeClientId, scopes: Array.isArray(r.scopes) ? (r.scopes as string[]) : [], status: r.status, capturedAt: r.capturedAt, expiresAt: r.expiresAt,
});

/** The household summary view. ADMIN and MANAGER only (registry area household-intelligence); a manager needs at least one member in their scope. */
export async function loadHouseholdSummary(viewer: Viewer, householdId: string, now: Date = new Date()): Promise<HouseholdSummary | null> {
  if (!can(viewer.role, "household-intelligence", "view")) return null;
  const [household, visible] = await Promise.all([
    prisma.household.findUnique({
      where: { id: householdId },
      select: { id: true, members: { select: { clientId: true, relationship: true, isPrimary: true, client: { select: { name: true, clientCode: true, assignedToId: true, isDeleted: true, mergedIntoId: true } } } } },
    }),
    getVisibleUserIds(viewer.userId, viewer.role as Parameters<typeof getVisibleUserIds>[1]),
  ]);
  if (!household) return null;
  const live = household.members.filter((m) => !m.client.isDeleted && !m.client.mergedIntoId);
  const members: MemberInput[] = live.map((m) => ({ clientId: m.clientId, name: m.client.name, clientCode: m.client.clientCode, relationship: m.relationship, isPrimary: m.isPrimary, inScope: canViewClient(viewer.role, visible, m.client) }));
  // A manager who looks after nobody in this household does not get to know it exists.
  if (!members.some((m) => m.inScope)) return null;
  const rows = await prisma.householdRelationshipConsent.findMany({ where: { householdId, subjectClientId: { in: members.map((m) => m.clientId) } }, orderBy: { capturedAt: "desc" }, take: 500 });
  return buildHouseholdSummary({ role: viewer.role, members, consents: rows.map(toConsent), viewerMemberIds: members.filter((m) => m.inScope).map((m) => m.clientId), now, fetchers: dbFetchers });
}

export type HouseholdContext = {
  inHousehold: boolean;
  householdCode: string | null;
  otherMemberCount: number;
  /** Other members the viewer can already open themselves (same RM or team). */
  ownMembers: { clientId: string; name: string; clientCode: string }[];
  /** Members behind the wall: only that they exist. */
  hiddenMemberCount: number;
};

/**
 * What the RM of one customer sees about that customer's household on Customer 360: that the relationship exists, how many other
 * members there are, and the ones that are already theirs to open. Everything else about a member who is another RM's customer is
 * behind the wall (see policy.ts).
 */
export async function loadHouseholdContext(viewer: Viewer, clientId: string): Promise<HouseholdContext | null> {
  const auth = await authoriseMemory(viewer, clientId);
  if (!auth.ok) return null;
  const visible = await getVisibleUserIds(viewer.userId, viewer.role as Parameters<typeof getVisibleUserIds>[1]);
  const mine = await prisma.householdMember.findFirst({ where: { clientId }, select: { household: { select: { id: true, householdCode: true } } } });
  if (!mine) return { inHousehold: false, householdCode: null, otherMemberCount: 0, ownMembers: [], hiddenMemberCount: 0 };
  const others = await prisma.householdMember.findMany({ where: { householdId: mine.household.id, clientId: { not: clientId }, client: { isDeleted: false, mergedIntoId: null } }, select: { client: { select: { id: true, name: true, clientCode: true, assignedToId: true, isDeleted: true, mergedIntoId: true } } } });
  const own = others.filter((o) => canViewClient(viewer.role, visible, o.client));
  return {
    inHousehold: true,
    householdCode: mine.household.householdCode,
    otherMemberCount: others.length,
    ownMembers: own.map((o) => ({ clientId: o.client.id, name: o.client.name, clientCode: o.client.clientCode })),
    hiddenMemberCount: others.length - own.length,
  };
}

export type ConsentInput = {
  householdId: string;
  subjectClientId: string;
  /** null = for every member's RM. */
  granteeClientId: string | null;
  status: "GRANTED" | "WITHDRAWN";
  scopes: readonly string[];
  evidenceRef?: string | null;
  expiresAt?: Date | null;
  source?: string;
  now?: Date;
};

export type ConsentResult = { ok: true; id: string } | { ok: false; code: "NOT_FOUND" | "INVALID"; message: string };

/**
 * Records a member's relationship consent as a new ledger row (the newest row per grantee is the current statement; nothing is
 * edited). Whoever records it must be able to open the SUBJECT member's own record (their RM, their manager, or an admin): nobody
 * can grant on behalf of a member they do not look after.
 */
export async function recordRelationshipConsent(viewer: Viewer, input: ConsentInput): Promise<ConsentResult> {
  const notFound: ConsentResult = { ok: false, code: "NOT_FOUND", message: "Not found." };
  if (!can(viewer.role, "client-consent", "manage")) return notFound;
  const now = input.now ?? new Date();
  const subject = await authoriseMemory(viewer, input.subjectClientId); // same record scope as the customer
  if (!subject.ok) return notFound;
  const members = await prisma.householdMember.findMany({ where: { householdId: input.householdId }, select: { clientId: true }, take: 100 });
  const ids = new Set(members.map((m) => m.clientId));
  if (!ids.has(input.subjectClientId)) return notFound;
  if (input.granteeClientId && (!ids.has(input.granteeClientId) || input.granteeClientId === input.subjectClientId)) return { ok: false, code: "INVALID", message: "The person it is shared with must be another member of this household." };
  let scopes: string[] = [];
  if (input.status === "GRANTED") {
    const v = validateConsentScopes(input.scopes);
    if (!v.ok) return { ok: false, code: "INVALID", message: v.message };
    scopes = v.scopes;
  }
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.householdRelationshipConsent.create({
      data: { householdId: input.householdId, subjectClientId: input.subjectClientId, granteeClientId: input.granteeClientId, scopes: scopes as Prisma.InputJsonValue, status: input.status, source: input.source ?? "RM_RECORDED", evidenceRef: input.evidenceRef ?? null, capturedById: viewer.userId, capturedAt: now, expiresAt: input.expiresAt ?? null },
    });
    await tx.auditLog.create({ data: { userId: viewer.userId, entity: "HouseholdRelationshipConsent", entityId: row.id, action: input.status === "GRANTED" ? "household.consent.granted" : "household.consent.withdrawn", newValue: { householdId: input.householdId, subjectClientId: input.subjectClientId, granteeClientId: input.granteeClientId, scopes } as Prisma.InputJsonValue } });
    return row;
  });
  return { ok: true, id: created.id };
}

/** The facets a member can agree to share, for the consent form. */
export const SHAREABLE_FACETS = CONSENTABLE_FACETS;
export { facetVisible };
