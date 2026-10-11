import { agentEnabled } from "@/lib/agents/enabled";
import { prisma } from "@/lib/db/prisma";

import { AI_CREATIVE_KEY } from "./ai";
import type { BrandProfile } from "./brand";
import type { FieldValues, FormatKey } from "./formats";
import type { RuleCheck } from "@/lib/guardrails";
import { loadBrandProfile } from "./store";
import type { VariantStatus } from "./variant-workflow";

/** What the Briefs tab needs, as plain serialisable data. Staff-written copy only: no customer data. */

export type VariantView = {
  id: string; format: FormatKey; language: "en" | "hinglish"; fields: FieldValues; disclaimer: string; status: VariantStatus; source: "STAFF" | "AI";
  complianceStatus: "PASS" | "FAIL"; checks: RuleCheck[]; score: number | null; verdict: string | null; authorId: string; approvedById: string | null; approvedAt: string | null; reviewNote: string | null;
  events: { action: string; actorId: string; at: string; note: string | null }[];
};
export type BriefView = {
  id: string; title: string; topic: string; audience: string; language: "en" | "hinglish"; hookType: string; master: { hook: string; usp: string; cta: string }; formats: string[]; referenceIds: string[]; createdAt: string; brandVersion: number | null; variants: VariantView[];
};
export type ReferenceView = { id: string; competitor: string; copy: string; format: string; hookTag: string | null; offerTag: string | null; startDate: string | null };

export type BriefsData = { briefs: BriefView[]; references: ReferenceView[]; brand: { version: number; profile: BrandProfile }; aiOn: boolean };

export async function loadBriefs(): Promise<BriefsData> {
  const [rows, refs, brand, aiOn] = await Promise.all([
    prisma.creativeBrief.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { variants: { orderBy: { createdAt: "asc" }, include: { events: { orderBy: { createdAt: "desc" }, take: 6 } } } } }),
    prisma.competitorAd.findMany({ orderBy: { createdAt: "desc" }, take: 300, select: { id: true, copy: true, format: true, hookTag: true, offerTag: true, startDate: true, competitor: { select: { name: true } } } }),
    loadBrandProfile(),
    agentEnabled(AI_CREATIVE_KEY, process.env, (key) => prisma.agentSetting.findUnique({ where: { agentKey: key }, select: { enabled: true } })),
  ]);
  const briefs: BriefView[] = rows.map((b) => ({
    id: b.id, title: b.title, topic: b.topic, audience: b.audience, language: b.language === "hinglish" ? "hinglish" : "en", hookType: b.hookType, master: b.master as BriefView["master"], formats: b.formats, referenceIds: b.referenceIds, createdAt: b.createdAt.toISOString(), brandVersion: b.brandVersion,
    variants: b.variants.map((v) => ({
      id: v.id, format: v.format as FormatKey, language: v.language === "hinglish" ? "hinglish" : "en", fields: v.fields as FieldValues, disclaimer: v.disclaimer, status: v.status as VariantStatus, source: v.source === "AI" ? "AI" : "STAFF",
      complianceStatus: v.complianceStatus === "PASS" ? "PASS" : "FAIL", checks: (v.complianceChecks ?? []) as RuleCheck[], score: v.score, verdict: v.verdict, authorId: v.authorId, approvedById: v.approvedById, approvedAt: v.approvedAt ? v.approvedAt.toISOString() : null, reviewNote: v.reviewNote,
      events: v.events.map((e) => ({ action: e.action, actorId: e.actorId, at: e.createdAt.toISOString(), note: e.note })),
    })),
  }));
  const references: ReferenceView[] = refs.map((r) => ({ id: r.id, competitor: r.competitor.name, copy: r.copy, format: r.format, hookTag: r.hookTag, offerTag: r.offerTag, startDate: r.startDate ? r.startDate.toISOString().slice(0, 10) : null }));
  return { briefs, references, brand, aiOn };
}
