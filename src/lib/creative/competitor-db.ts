import { prisma } from "@/lib/db/prisma";

import { parseCompetitorCsv, suggestCompetitorTags, type ImportedAd } from "./competitor";

/** Saved competitors and their manually imported ads. Nothing here fetches anything from the internet. */

export type CompetitorAdView = { id: string; competitorId: string; competitor: string; copy: string; format: string; startDate: string | null; link: string | null; thumbnailRef: string | null; hookTag: string | null; offerTag: string | null; tagStatus: string; tagSource: string };

export async function listCompetitors() {
  return prisma.competitorWatch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, pageId: true, notes: true, _count: { select: { ads: true } } } });
}

export async function listCompetitorAds(): Promise<CompetitorAdView[]> {
  const rows = await prisma.competitorAd.findMany({ include: { competitor: { select: { name: true } } }, take: 1000, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({ id: r.id, competitorId: r.competitorId, competitor: r.competitor.name, copy: r.copy, format: r.format, startDate: r.startDate ? r.startDate.toISOString().slice(0, 10) : null, link: r.link, thumbnailRef: r.thumbnailRef, hookTag: r.hookTag, offerTag: r.offerTag, tagStatus: r.tagStatus, tagSource: r.tagSource }));
}

export async function addCompetitor(input: { name: string; pageId?: string; notes?: string; userId: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: "Give the competitor a name." };
  const existing = await prisma.competitorWatch.findUnique({ where: { name } });
  if (existing) return { ok: false, error: "That competitor is already on the list." };
  const row = await prisma.competitorWatch.create({ data: { name, pageId: input.pageId?.trim().slice(0, 80) || null, notes: input.notes?.trim().slice(0, 500) || null, createdById: input.userId } });
  return { ok: true, id: row.id };
}

export async function removeCompetitor(id: string): Promise<void> {
  await prisma.competitorWatch.delete({ where: { id } }).catch(() => undefined);
}

/** Saves one ad (typed by hand or from a CSV row). A repeat of the same competitor, wording and start date is skipped. Tags are suggested as DRAFTS by rules. */
export async function importAd(ad: ImportedAd, userId: string, create = true): Promise<"added" | "duplicate"> {
  let competitor = await prisma.competitorWatch.findUnique({ where: { name: ad.competitor } });
  if (!competitor) {
    if (!create) return "duplicate";
    competitor = await prisma.competitorWatch.create({ data: { name: ad.competitor.slice(0, 120), createdById: userId } });
  }
  const startDate = ad.startDate ? new Date(`${ad.startDate}T00:00:00Z`) : null;
  const dup = await prisma.competitorAd.findFirst({ where: { competitorId: competitor.id, copy: ad.copy, startDate } });
  if (dup) return "duplicate";
  const tags = suggestCompetitorTags(ad.copy);
  await prisma.competitorAd.create({ data: { competitorId: competitor.id, copy: ad.copy.slice(0, 3000), format: ad.format, startDate, link: ad.link, thumbnailRef: ad.thumbnailRef, hookTag: tags.hook, offerTag: tags.offer, tagStatus: "DRAFT", tagSource: "RULE", importedById: userId } });
  return "added";
}

export async function importCsv(text: string, userId: string): Promise<{ added: number; duplicates: number; errors: { line: number; message: string }[] }> {
  const parsed = parseCompetitorCsv(text.slice(0, 500_000));
  let added = 0;
  let duplicates = 0;
  for (const row of parsed.rows.slice(0, 500)) (await importAd(row, userId)) === "added" ? added++ : duplicates++;
  return { added, duplicates, errors: parsed.errors.slice(0, 20) };
}

export async function setAdTags(id: string, tags: { hook: string | null; offer: string | null }): Promise<void> {
  await prisma.competitorAd.update({ where: { id }, data: { hookTag: tags.hook, offerTag: tags.offer, tagStatus: "CONFIRMED", tagSource: "HUMAN" } });
}

export async function removeAd(id: string): Promise<void> {
  await prisma.competitorAd.delete({ where: { id } }).catch(() => undefined);
}
