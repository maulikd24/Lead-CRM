import { prisma } from "@/lib/db/prisma";

import { heuristicTags, TAG_TYPES, TAG_VOCAB, type TagType, type Tags, type TaggedCreative } from "./winners";

/** Tags on live ads. A person's tag is CONFIRMED; a suggestion (by rules or by the draft-only AI path) is a DRAFT until confirmed, and never overwrites a confirmed tag. */

export type StoredTags = Map<string, { tags: Tags; status: "CONFIRMED" | "DRAFT"; sources: Partial<Record<TagType, string>> }>;

export async function loadTags(adKeys: string[]): Promise<StoredTags> {
  const out: StoredTags = new Map();
  if (adKeys.length === 0) return out;
  const rows = await prisma.creativeTag.findMany({ where: { adKey: { in: adKeys } } });
  for (const r of rows) {
    if (!(TAG_TYPES as readonly string[]).includes(r.tagType)) continue;
    const e = out.get(r.adKey) ?? { tags: {}, status: "CONFIRMED" as const, sources: {} };
    e.tags[r.tagType as TagType] = r.value;
    e.sources[r.tagType as TagType] = r.source;
    if (r.status !== "CONFIRMED") e.status = "DRAFT";
    out.set(r.adKey, e);
  }
  return out;
}

export function asTagged(ad: { key: string; name: string; spend: number; funded: number }, stored: StoredTags): TaggedCreative {
  const s = stored.get(ad.key);
  return { key: ad.key, name: ad.name, spend: ad.spend, funded: ad.funded, tags: s?.tags ?? {}, tagStatus: s?.status ?? "CONFIRMED" };
}

export async function setTag(input: { channel: string; adId: string; adName: string; type: TagType; value: string; userId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!TAG_VOCAB[input.type]?.includes(input.value)) return { ok: false, error: "That is not an allowed tag value." };
  const adKey = `${input.channel}:${input.adId}`;
  await prisma.creativeTag.upsert({
    where: { adKey_tagType: { adKey, tagType: input.type } },
    create: { adKey, channel: input.channel, adId: input.adId, adName: input.adName.slice(0, 200), tagType: input.type, value: input.value, status: "CONFIRMED", source: "HUMAN", updatedById: input.userId },
    update: { value: input.value, status: "CONFIRMED", source: "HUMAN", updatedById: input.userId },
  });
  return { ok: true };
}

export async function clearTag(adKey: string, type: TagType): Promise<void> {
  await prisma.creativeTag.deleteMany({ where: { adKey, tagType: type } });
}

export async function confirmDraftTags(adKey: string, userId: string): Promise<number> {
  const res = await prisma.creativeTag.updateMany({ where: { adKey, status: "DRAFT" }, data: { status: "CONFIRMED", updatedById: userId } });
  return res.count;
}

/** Stores suggested tags as DRAFTS, leaving any tag a person already confirmed untouched. Returns how many were written. */
export async function saveSuggestedTags(ad: { channel: string; adId: string; adName: string }, tags: Tags, source: "RULE" | "AI"): Promise<number> {
  const adKey = `${ad.channel}:${ad.adId}`;
  const existing = await prisma.creativeTag.findMany({ where: { adKey } });
  let n = 0;
  for (const type of TAG_TYPES) {
    const value = tags[type];
    if (!value || !TAG_VOCAB[type].includes(value)) continue;
    const have = existing.find((e) => e.tagType === type);
    if (have?.status === "CONFIRMED") continue;
    await prisma.creativeTag.upsert({
      where: { adKey_tagType: { adKey, tagType: type } },
      create: { adKey, channel: ad.channel, adId: ad.adId, adName: ad.adName.slice(0, 200), tagType: type, value, status: "DRAFT", source },
      update: { value, status: "DRAFT", source },
    });
    n++;
  }
  return n;
}

export const ruleTagsFor = (ad: { adName: string; format: string | null }): Tags => heuristicTags({ copy: ad.adName, format: ad.format ?? "" });
