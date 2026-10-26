import { prisma } from "@/lib/db/prisma";
import { buildClientWhere } from "@/lib/clients/build-client-where";
import { filterConsented } from "@/lib/consent/enforce";

import { audienceFilter, type BroadcastAudience, type BroadcastChannel } from "./schema";

/** The most customers read to apply the consent filter. Above it the consented count is a scaled estimate and says so. */
export const CONSENT_SAMPLE_CAP = 5000;

export type AudienceEstimate = { matched: number; consented: number; approximate: boolean };

/**
 * How many customers an audience reaches, and how many of them may get a marketing message on the channel. Aggregate numbers only:
 * Marketing works at campaign level and never sees a named customer here (src/lib/access/policy.ts). The scope is org-wide because
 * only ADMIN and MARKETING can call this, and neither is scoped to a team.
 */
export async function estimateAudience(audience: BroadcastAudience, channel: BroadcastChannel): Promise<AudienceEstimate> {
  const where = buildClientWhere(audienceFilter(audience), null);
  const matched = await prisma.client.count({ where });
  if (matched === 0) return { matched, consented: 0, approximate: false };
  const ids = (await prisma.client.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: CONSENT_SAMPLE_CAP })).map((c) => c.id);
  const allowed = (await filterConsented(ids, "MARKETING_COMMS", channel)).length;
  if (matched <= CONSENT_SAMPLE_CAP) return { matched, consented: allowed, approximate: false };
  return { matched, consented: Math.round((allowed / ids.length) * matched), approximate: true };
}

export type AudienceOptions = {
  stages: { id: string; name: string }[];
  segments: { key: string; count: number }[];
  leadSources: { key: string; count: number }[];
};

/** The choices the audience step offers: active stages, live segments and the most common lead sources, with sizes. */
export async function loadAudienceOptions(): Promise<AudienceOptions> {
  const [stages, segments, sources] = await Promise.all([
    prisma.stage.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { sequence: "asc" } }),
    prisma.segmentMembership.groupBy({ by: ["segment"], where: { exitedAt: null, client: { isDeleted: false } }, _count: { _all: true }, orderBy: { _count: { segment: "desc" } }, take: 12 }),
    prisma.client.groupBy({ by: ["leadSource"], where: { isDeleted: false, leadSource: { not: null } }, _count: { _all: true }, orderBy: { _count: { leadSource: "desc" } }, take: 12 }),
  ]);
  return {
    stages,
    segments: segments.map((s) => ({ key: s.segment, count: s._count._all })),
    leadSources: sources.filter((s) => s.leadSource).map((s) => ({ key: s.leadSource!, count: s._count._all })),
  };
}

export type StudioTemplate = { id: string; name: string; channel: BroadcastChannel; body: string; variables: string[] };
