import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

import { brandProfileSchema, DEFAULT_BRAND_PROFILE, nextProfileVersion, type BrandProfile } from "./brand";
import type { FieldValues } from "./formats";
import type { RuleCheck } from "./rules";
import { createCreativeService, type BriefRow, type CreativeStore, type VariantRow } from "./service";
import type { VariantStatus } from "./variant-workflow";

const json = (v: unknown) => v as Prisma.InputJsonValue;

const briefRow = (r: Awaited<ReturnType<typeof prisma.creativeBrief.findUniqueOrThrow>>): BriefRow => ({
  id: r.id, title: r.title, topic: r.topic, audience: r.audience, language: r.language === "hinglish" ? "hinglish" : "en", hookType: r.hookType, usp: r.usp, cta: r.cta,
  master: r.master as BriefRow["master"], formats: r.formats, referenceIds: r.referenceIds, brandVersion: r.brandVersion, createdById: r.createdById,
});

export const variantRow = (r: Awaited<ReturnType<typeof prisma.creativeVariant.findUniqueOrThrow>>): VariantRow => ({
  id: r.id, briefId: r.briefId, format: r.format as VariantRow["format"], language: r.language === "hinglish" ? "hinglish" : "en", fields: r.fields as FieldValues, disclaimer: r.disclaimer,
  status: r.status as VariantStatus, source: r.source === "AI" ? "AI" : "STAFF", complianceStatus: r.complianceStatus === "PASS" ? "PASS" : "FAIL", complianceChecks: (r.complianceChecks ?? []) as RuleCheck[],
  score: r.score, verdict: r.verdict, authorId: r.authorId, approvedById: r.approvedById, approvedAt: r.approvedAt, reviewNote: r.reviewNote,
});

export const prismaCreativeStore: CreativeStore = {
  async insertBrief(d) {
    return briefRow(await prisma.creativeBrief.create({ data: { ...d, master: json(d.master) } }));
  },
  async insertVariant(d) {
    return variantRow(await prisma.creativeVariant.create({ data: { ...d, fields: json(d.fields), complianceChecks: json(d.complianceChecks) } }));
  },
  async getBrief(id) {
    const r = await prisma.creativeBrief.findUnique({ where: { id } });
    return r ? briefRow(r) : null;
  },
  async getVariant(id) {
    const r = await prisma.creativeVariant.findUnique({ where: { id } });
    return r ? variantRow(r) : null;
  },
  async variantsOf(briefId) {
    return (await prisma.creativeVariant.findMany({ where: { briefId }, orderBy: { createdAt: "asc" } })).map(variantRow);
  },
  async casUpdateVariant(id, expected, data) {
    const { fields, complianceChecks, ...rest } = data;
    const res = await prisma.creativeVariant.updateMany({ where: { id, status: expected }, data: { ...rest, ...(fields !== undefined ? { fields: json(fields) } : {}), ...(complianceChecks !== undefined ? { complianceChecks: json(complianceChecks) } : {}) } });
    return res.count === 1;
  },
  async updateBriefReferences(id, referenceIds) {
    await prisma.creativeBrief.update({ where: { id }, data: { referenceIds } });
  },
  async addEvent(e) {
    await prisma.creativeEvent.create({ data: e });
  },
  async deleteBrief(id) {
    await prisma.creativeBrief.delete({ where: { id } });
  },
};

/** The brand profile in force: the newest saved version, or the built-in default (version 0) until one is saved. */
export async function loadBrandProfile(): Promise<{ version: number; profile: BrandProfile }> {
  const row = await prisma.brandProfileVersion.findFirst({ orderBy: { version: "desc" } });
  if (!row) return { version: 0, profile: DEFAULT_BRAND_PROFILE };
  const parsed = brandProfileSchema.safeParse(row.profile);
  return parsed.success ? { version: row.version, profile: parsed.data } : { version: 0, profile: DEFAULT_BRAND_PROFILE };
}

export async function saveBrandProfile(input: unknown, userId: string): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const parsed = brandProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The brand profile is not valid: it needs a voice, at least one audience and a risk disclaimer." };
  const versions = (await prisma.brandProfileVersion.findMany({ select: { version: true } })).map((v) => v.version);
  const version = nextProfileVersion(versions);
  await prisma.brandProfileVersion.create({ data: { version, profile: json(parsed.data), createdById: userId } });
  return { ok: true, version };
}

export const creativeService = () =>
  createCreativeService({
    store: prismaCreativeStore,
    getProfile: loadBrandProfile,
    loadReferenceCopies: async (ids) => (await prisma.competitorAd.findMany({ where: { id: { in: ids } }, select: { copy: true } })).map((r) => r.copy),
    audit: async (a) => void (await prisma.auditLog.create({ data: { userId: a.userId, entity: "CreativeVariant", entityId: a.entityId, action: a.action } })),
    now: () => new Date(),
  });
