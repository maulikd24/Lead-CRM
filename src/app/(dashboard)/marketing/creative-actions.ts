"use server";

import { revalidatePath } from "next/cache";

import { agentEnabled } from "@/lib/agents/enabled";
import { gatewayProvider } from "@/lib/ai/gateway";
import { prisma } from "@/lib/db/prisma";
import { AI_CREATIVE_KEY, generateKitWithAi, suggestTagsWithAi } from "@/lib/creative/ai";
import { importAd, importCsv, removeAd, removeCompetitor, addCompetitor, setAdTags } from "@/lib/creative/competitor-db";
import { deleteExperiment, saveExperiment, type ExperimentInputRaw } from "@/lib/creative/experiments-db";
import type { FieldValues } from "@/lib/creative/formats";
import { briefInputSchema, generateKit } from "@/lib/creative/kit";
import { saveFatigueThresholds, saveWinnerSettings } from "@/lib/creative/settings";
import { creativeService, loadBrandProfile, saveBrandProfile } from "@/lib/creative/store";
import { clearTag, confirmDraftTags, ruleTagsFor, saveSuggestedTags, setTag } from "@/lib/creative/tags-db";
import { TAG_TYPES, type TagType } from "@/lib/creative/winners";
import { COMPETITOR_FORMATS } from "@/lib/creative/competitor";

import type { Action, Area } from "@/lib/access/policy";
import { requireAccess, requireMarketing, type MarketingArea } from "@/lib/auth/require-role";
import { creativeIntelEnabled } from "@/lib/creative/flags";

import { OFF, text, type Actor, type ActionResult } from "./creative-gate";

/**
 * Server actions for creative intelligence, ad copy drafts, competitor ads and experiments. Every one goes through
 * gate() (the central registry, then the flag) before it reads or writes anything, and never trusts what the browser said
 * about a status or a check result: the service recomputes both. Nothing here publishes an ad or sends anything.
 */

/**
 * The one door for every action in this file: the central registry decides (requireMarketing for the marketing areas, requireAccess for the
 * AI registry's kill switch), then the feature flag. Returns null when the feature is switched off. The area is named at each call site and
 * pinned to ACTION_POLICY by lib/creative/access-conformance.test.ts.
 */
async function gate(area: MarketingArea | Extract<Area, "settings-ai">, action: Action = "manage"): Promise<Actor | null> {
  const session = area === "settings-ai" ? await requireAccess(area, action) : await requireMarketing(area, action);
  return creativeIntelEnabled() ? { id: session.user.id, role: session.user.role as string } : null;
}

const done = <T extends ActionResult>(r: T): T => {
  revalidatePath("/marketing");
  return r;
};
const fail = (error: string) => ({ ok: false as const, error });

function aiDeps() {
  return { provider: gatewayProvider(), isEnabled: () => agentEnabled(AI_CREATIVE_KEY, process.env, (key) => prisma.agentSetting.findUnique({ where: { agentKey: key }, select: { enabled: true } })) };
}

// ---- Briefs and variants --------------------------------------------------------------------------------------------

export async function createBriefAction(input: unknown, mode: unknown, referenceIds: unknown): Promise<ActionResult<{ briefId: string }>> {
  const actor = await gate("marketing-creative");
  if (!actor) return OFF;
  const parsed = briefInputSchema.safeParse(input);
  if (!parsed.success) return fail("Check the brief: it needs a title, a topic, an audience, a language, a hook style and at least one channel.");
  const refs = Array.isArray(referenceIds) ? referenceIds.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  const { profile } = await loadBrandProfile();
  let kit = generateKit(parsed.data, profile);
  let source: "STAFF" | "AI" = "STAFF";
  if (mode === "ai") {
    const ai = await generateKitWithAi(parsed.data, profile, aiDeps());
    if (!ai.ok) return fail(ai.reason === "disabled" ? "AI drafting is switched off." : ai.reason === "unavailable" ? "The AI service could not be reached. Nothing was drafted." : ai.reason === "abstained" || ai.reason === "blocked" ? `Nothing was drafted. ${ai.detail ?? ""}`.trim() : ai.reason === "unsafe" ? `The draft did not pass the compliance review, so it was not kept. ${ai.detail ?? ""}`.trim() : "The AI did not produce a usable draft. Try the templates or reword the brief.");
    kit = ai.kit;
    source = "AI";
  }
  const res = await creativeService().createFromKit({ input: parsed.data, kit, source, actor, referenceIds: refs });
  return done(res.ok ? { ok: true, briefId: res.briefId } : res);
}

function toFields(raw: unknown): FieldValues | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: FieldValues = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k) || !Array.isArray(v) || v.length > 20 || v.some((x) => typeof x !== "string")) return null;
    out[k] = (v as string[]).map((x) => x.slice(0, 1000));
  }
  return out;
}

export async function saveVariantAction(variantId: unknown, input: { fields: unknown; disclaimer?: unknown }): Promise<ActionResult> {
  const actor = await gate("marketing-creative");
  if (!actor) return OFF;
  const fields = toFields(input.fields);
  if (!fields) return fail("The copy could not be read.");
  return done(await creativeService().editVariant(text(variantId, 64), { fields, disclaimer: typeof input.disclaimer === "string" ? input.disclaimer.slice(0, 900) : undefined }, actor));
}

const VARIANT_ACTIONS = ["submit", "approve", "request_changes"] as const;

export async function transitionVariantAction(variantId: unknown, action: unknown, input: { confirmed?: unknown; note?: unknown } = {}): Promise<ActionResult> {
  const actor = await gate("marketing-creative");
  if (!actor) return OFF;
  if (!(VARIANT_ACTIONS as readonly unknown[]).includes(action)) return fail("That action does not exist.");
  return done(await creativeService().transition(text(variantId, 64), action as (typeof VARIANT_ACTIONS)[number], actor, { confirmed: input.confirmed === true, note: text(input.note, 500) }));
}

export async function discardBriefAction(briefId: unknown): Promise<ActionResult> {
  const actor = await gate("marketing-creative");
  if (!actor) return OFF;
  return done(await creativeService().discardBrief(text(briefId, 64), actor));
}

export async function attachReferenceAction(briefId: unknown, adId: unknown): Promise<ActionResult> {
  const actor = await gate("marketing-creative");
  if (!actor) return OFF;
  return done(await creativeService().attachReference(text(briefId, 64), text(adId, 64), actor));
}

// ---- Brand profile, thresholds, AI switch -----------------------------------------------------------------------------

export async function saveBrandProfileAction(profile: unknown): Promise<ActionResult<{ version: number }>> {
  const actor = await gate("marketing-creative");
  if (!actor) return OFF;
  return done(await saveBrandProfile(profile, actor.id));
}

export async function saveThresholdsAction(kind: unknown, values: unknown): Promise<ActionResult> {
  const actor = await gate("marketing-creative");
  if (!actor) return OFF;
  if (kind === "fatigue") return done(await saveFatigueThresholds(values, actor.id));
  if (kind === "winners") return done(await saveWinnerSettings(values, actor.id));
  return fail("Unknown settings group.");
}

/** The AI drafter's own kill switch (Admin only), in addition to the environment flag. */
export async function setAiCreativeAction(enabled: unknown): Promise<ActionResult<{ message: string }>> {
  const actor = await gate("settings-ai");
  if (!actor) return OFF;
  const on = enabled === true;
  await prisma.agentSetting.upsert({ where: { agentKey: AI_CREATIVE_KEY }, create: { agentKey: AI_CREATIVE_KEY, enabled: on, updatedById: actor.id }, update: { enabled: on, updatedById: actor.id } });
  return done({ ok: true, message: on ? "AI drafting for ad copy is on." : "AI drafting for ad copy is off." });
}

// ---- Tags -------------------------------------------------------------------------------------------------------------------

export async function setTagAction(input: { channel: unknown; adId: unknown; adName: unknown; type: unknown; value: unknown }): Promise<ActionResult> {
  const actor = await gate("marketing-creative");
  if (!actor) return OFF;
  const type = input.type as TagType;
  if (!(TAG_TYPES as readonly unknown[]).includes(type)) return fail("Unknown tag type.");
  const value = text(input.value, 40);
  if (value === "") {
    await clearTag(`${text(input.channel, 20)}:${text(input.adId, 100)}`, type);
    return done({ ok: true });
  }
  return done(await setTag({ channel: text(input.channel, 20), adId: text(input.adId, 100), adName: text(input.adName, 200), type, value, userId: actor.id }));
}

export async function confirmTagsAction(adKey: unknown): Promise<ActionResult<{ confirmed: number }>> {
  const actor = await gate("marketing-creative");
  if (!actor) return OFF;
  return done({ ok: true, confirmed: await confirmDraftTags(text(adKey, 140), actor.id) });
}

/** Suggests tags for the listed ads as DRAFTS: rules first, then (only if the AI switch is on) the draft-only AI path. A confirmed tag is never overwritten. */
export async function suggestTagsAction(ads: unknown): Promise<ActionResult<{ suggested: number }>> {
  const actor = await gate("marketing-creative");
  if (!actor) return OFF;
  if (!Array.isArray(ads)) return fail("Nothing to tag.");
  let n = 0;
  const deps = aiDeps();
  for (const raw of ads.slice(0, 40)) {
    const a = raw as { channel?: unknown; adId?: unknown; adName?: unknown; format?: unknown };
    const ad = { channel: text(a.channel, 20), adId: text(a.adId, 100), adName: text(a.adName, 200) };
    if (!ad.channel || !ad.adId) continue;
    n += await saveSuggestedTags(ad, ruleTagsFor({ adName: ad.adName, format: text(a.format, 60) }), "RULE");
    const ai = await suggestTagsWithAi({ name: ad.adName, format: text(a.format, 60) }, deps);
    if (ai.ok) n += await saveSuggestedTags(ad, ai.tags, "AI");
  }
  return done({ ok: true, suggested: n });
}

// ---- Competitors ------------------------------------------------------------------------------------------------------------

export async function addCompetitorAction(input: { name: unknown; pageId?: unknown; notes?: unknown }): Promise<ActionResult> {
  const actor = await gate("marketing-competitor-ads");
  if (!actor) return OFF;
  return done(await addCompetitor({ name: text(input.name, 120), pageId: text(input.pageId, 80), notes: text(input.notes, 500), userId: actor.id }));
}

export async function removeCompetitorAction(id: unknown): Promise<ActionResult> {
  const actor = await gate("marketing-competitor-ads");
  if (!actor) return OFF;
  await removeCompetitor(text(id, 64));
  return done({ ok: true });
}

export async function addCompetitorAdAction(input: { competitor: unknown; copy: unknown; format: unknown; startDate?: unknown; link?: unknown; thumbnailRef?: unknown }): Promise<ActionResult> {
  const actor = await gate("marketing-competitor-ads");
  if (!actor) return OFF;
  const copy = text(input.copy, 3000).trim();
  const competitor = text(input.competitor, 120).trim();
  if (!copy || !competitor) return fail("Add the competitor and the ad copy.");
  const start = text(input.startDate, 10);
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) return fail("The start date must look like 2026-09-30.");
  const link = text(input.link, 500).trim();
  if (link && !/^https?:\/\/\S+$/i.test(link)) return fail("The link must start with http:// or https://.");
  const thumb = text(input.thumbnailRef, 200).trim();
  if (thumb && !(/^https?:\/\/\S+$/i.test(thumb) || /^[A-Za-z0-9._:/-]{1,200}$/.test(thumb))) return fail("The thumbnail pointer must be a web address or a short reference, never embedded image data.");
  const format = (COMPETITOR_FORMATS as readonly string[]).includes(text(input.format, 20)) ? text(input.format, 20) : "other";
  const r = await importAd({ competitor, copy, format, startDate: start || null, link: link || null, thumbnailRef: thumb || null }, actor.id);
  return done(r === "added" ? { ok: true } : fail("That ad is already saved."));
}

export async function importCompetitorCsvAction(csv: unknown): Promise<ActionResult<{ added: number; duplicates: number; errors: { line: number; message: string }[] }>> {
  const actor = await gate("marketing-competitor-ads");
  if (!actor) return OFF;
  return done({ ok: true, ...(await importCsv(text(csv, 500_000), actor.id)) });
}

export async function setCompetitorAdTagsAction(id: unknown, tags: { hook?: unknown; offer?: unknown }): Promise<ActionResult> {
  const actor = await gate("marketing-competitor-ads");
  if (!actor) return OFF;
  await setAdTags(text(id, 64), { hook: text(tags.hook, 40) || null, offer: text(tags.offer, 40) || null });
  return done({ ok: true });
}

export async function removeCompetitorAdAction(id: unknown): Promise<ActionResult> {
  const actor = await gate("marketing-competitor-ads");
  if (!actor) return OFF;
  await removeAd(text(id, 64));
  return done({ ok: true });
}

// ---- Experiments ------------------------------------------------------------------------------------------------------------

export async function saveExperimentAction(id: unknown, input: Partial<Record<keyof ExperimentInputRaw, unknown>>): Promise<ActionResult<{ id: string }>> {
  const actor = await gate("marketing-experiments");
  if (!actor) return OFF;
  const { normaliseExperiment } = await import("@/lib/creative/experiments-db");
  return done(await saveExperiment(typeof id === "string" && id ? id.slice(0, 64) : null, normaliseExperiment(input), actor.id));
}

export async function deleteExperimentAction(id: unknown): Promise<ActionResult> {
  const actor = await gate("marketing-experiments");
  if (!actor) return OFF;
  await deleteExperiment(text(id, 64));
  return done({ ok: true });
}
