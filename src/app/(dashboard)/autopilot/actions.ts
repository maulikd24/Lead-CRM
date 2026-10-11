"use server";

import { revalidatePath } from "next/cache";

import { getProvider } from "@/lib/ai/provider";
import { answer, planByKeywords, planWithModel, type Answer } from "@/lib/autopilot/ask";
import { requireAutopilotViewer } from "@/lib/autopilot/access";
import { autopilotAskEnabled, autopilotPageEnabled } from "@/lib/autopilot/flags";
import { buildLaunchDraft, type LaunchInput } from "@/lib/autopilot/launch";
import { getActionProvider } from "@/lib/autopilot/provider";
import { decide } from "@/lib/autopilot/recommendations";
import { RULE_METRICS, validateRule, type Rule } from "@/lib/autopilot/rules";
import * as store from "@/lib/autopilot/store";

/**
 * Server actions for Autopilot. Each one first passes the access gate (ADMIN or MARKETING only), then the feature
 * flag, and never trusts what the browser says about status or permissions. Nothing here changes an ad account unless
 * applying is switched on AND a person approved the exact proposal.
 */

export type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };
const OFF = { ok: false as const, error: "Autopilot is switched off on this server." };
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

async function gate() {
  const viewer = await requireAutopilotViewer();
  return autopilotPageEnabled() ? viewer : null;
}
const done = <T>(r: Result<T>): Result<T> => { revalidatePath("/autopilot"); return r; };

export async function decideAction(recId: unknown, verdict: unknown, input: { reasonCode?: unknown; note?: unknown } = {}): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  if (verdict !== "approve" && verdict !== "deny") return { ok: false, error: "Unknown decision." };
  const rec = await store.getRecommendation(text(recId, 200));
  if (!rec) return { ok: false, error: "That proposal no longer exists." };
  const d = decide(rec, verdict, v.id, { reasonCode: text(input.reasonCode, 40), note: text(input.note, 500) });
  if (!d.ok) return d;
  if (!(await store.recordDecision(d.decision))) return { ok: false, error: "This proposal has already been decided." };
  return done({ ok: true });
}

export async function applyRecommendationAction(recId: unknown): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  const rec = await store.getRecommendation(text(recId, 200));
  if (!rec) return { ok: false, error: "That proposal no longer exists." };
  const res = await getActionProvider().apply(rec, rec.status === "APPROVED" ? v.id : null);
  if (res.ok) { await store.markApplied(rec.id, v.id, res); return done({ ok: true }); }
  return { ok: false, error: res.error };
}

export async function askAutopilotAction(question: unknown): Promise<Result<{ answer: Answer }>> {
  const v = await gate(); if (!v) return OFF;
  if (!autopilotAskEnabled()) return { ok: false, error: "Ask Autopilot is switched off on this server." };
  const q = text(question, 500);
  if (q.length < 3) return { ok: false, error: "Type a question." };
  const snap = await store.loadSnapshot({ pseudonymous: v.pseudonymous });
  let calls = planByKeywords(q);
  try { if (process.env.AI_PROVIDER !== "off" && process.env.ANTHROPIC_API_KEY) calls = await planWithModel(q, getProvider(), snap.campaigns.map((c) => c.name)); } catch { /* keyword plan stands */ }
  return { ok: true, answer: answer(q, calls, snap) };
}

function launchInput(raw: Record<string, unknown>): LaunchInput {
  const geo = (raw.geo ?? {}) as Record<string, unknown>; const aud = (raw.audience ?? {}) as Record<string, unknown>; const copy = (raw.copy ?? {}) as Record<string, unknown>;
  return {
    name: text(raw.name, 120), objective: raw.objective === "leads" ? "leads" : "funded_customers", platform: raw.platform === "google" ? "google" : "meta",
    totalBudget: num(raw.totalBudget) ?? 0, days: num(raw.days) ?? 0,
    audience: { description: text(aud.description, 300), ageMin: num(aud.ageMin) ?? undefined, ageMax: num(aud.ageMax) ?? undefined, usesCustomerList: aud.usesCustomerList === true },
    geo: { kind: geo.kind === "states" || geo.kind === "radius" ? geo.kind : "cities", values: String(geo.values ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 30), radiusKm: num(geo.radiusKm) ?? undefined },
    landingUrl: text(raw.landingUrl, 300), copy: { headline: text(copy.headline, 150), body: text(copy.body, 2000) },
  };
}

export async function previewLaunchAction(raw: Record<string, unknown>): Promise<Result<{ draft: ReturnType<typeof buildLaunchDraft> }>> {
  const v = await gate(); if (!v) return OFF;
  return { ok: true, draft: buildLaunchDraft(launchInput(raw), await store.loadSnapshot({ pseudonymous: v.pseudonymous })) };
}

export async function saveLaunchDraftAction(raw: Record<string, unknown>): Promise<Result<{ id: string }>> {
  const v = await gate(); if (!v) return OFF;
  const draft = buildLaunchDraft(launchInput(raw), await store.loadSnapshot({ pseudonymous: v.pseudonymous }));
  if (draft.errors.length) return { ok: false, error: draft.errors[0] };
  const id = await store.saveDraft({ name: draft.input.name, input: draft.input, estimates: draft.estimates, checklist: draft.checklist, complianceOk: draft.complianceClear }, v.id);
  return done({ ok: true, id });
}

/** "Launch as paused draft": creates the campaign PAUSED in the ad account. It cannot turn anything on. */
export async function launchPausedAction(id: unknown): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  const d = await store.getDraft(text(id, 64));
  if (!d || d.status !== "DRAFT") return { ok: false, error: "Only a saved draft can be launched." };
  if (!d.complianceOk) return { ok: false, error: "The compliance checklist has a failed item. Edit the copy first." };
  const input = d.input as LaunchInput;
  const res = await getActionProvider().launchPaused({ name: input.name, platform: input.platform, objective: input.objective, dailyBudget: Math.round(input.totalBudget / input.days), geo: input.geo, schedule: {}, bidding: {}, landingUrl: input.landingUrl, copy: input.copy, audience: input.audience }, v.id);
  if (!res.ok) return { ok: false, error: res.error };
  await store.updateDraft(d.id, v.id, "autopilot_draft_launched_paused", { status: "LAUNCHED_PAUSED", externalId: res.externalId, launchedById: v.id, launchedAt: new Date() });
  return done({ ok: true });
}

export async function recordAnnexureAction(id: unknown): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  const d = await store.getDraft(text(id, 64));
  if (!d || d.status === "DISCARDED") return { ok: false, error: "That draft does not exist." };
  await store.updateDraft(d.id, v.id, "autopilot_annexure_recorded", { annexureApproved: true });
  return done({ ok: true });
}

/** The second, explicit human act. Refused unless the draft is paused, compliant, annexure-approved and a different person acts. */
export async function activateDraftAction(id: unknown): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  const d = await store.getDraft(text(id, 64));
  if (!d) return { ok: false, error: "That draft does not exist." };
  const res = await getActionProvider().activate({ externalId: d.externalId, status: d.status, createdById: d.createdById, complianceOk: d.complianceOk, annexureApproved: d.annexureApproved }, v.id);
  if (!res.ok) return { ok: false, error: res.error ?? "Could not turn it on." };
  await store.updateDraft(d.id, v.id, "autopilot_draft_activated", { status: "ACTIVE", activatedById: v.id, activatedAt: new Date() });
  return done({ ok: true });
}

export async function discardDraftAction(id: unknown): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  const d = await store.getDraft(text(id, 64));
  if (!d || d.status !== "DRAFT") return { ok: false, error: "Only an unlaunched draft can be discarded." };
  await store.updateDraft(d.id, v.id, "autopilot_draft_discarded", { status: "DISCARDED" });
  return done({ ok: true });
}

export async function saveRuleAction(raw: Record<string, unknown>): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  const rule: Partial<Rule> = { name: text(raw.name, 80), metric: text(raw.metric, 40) as Rule["metric"], op: raw.op === "<" ? "<" : ">", threshold: num(raw.threshold) ?? NaN, days: num(raw.days) ?? 0, action: text(raw.action, 40) as Rule["action"], enabled: true, campaignIds: null };
  if (!(rule.metric! in RULE_METRICS)) return { ok: false, error: "Pick a measure." };
  const err = validateRule(rule); if (err) return { ok: false, error: err };
  await store.saveRule(rule as Omit<Rule, "id">, v.id);
  return done({ ok: true });
}

export async function toggleRuleAction(id: unknown, enabled: unknown): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  await store.setRuleEnabled(text(id, 64), enabled === true, v.id);
  return done({ ok: true });
}

export async function savePlanAction(campaignId: unknown, budget: unknown): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  const b = budget === "" || budget === null ? null : num(budget);
  if (b !== null && b < 0) return { ok: false, error: "Enter zero or more." };
  await store.savePlan(text(campaignId, 100), b, v.id);
  return done({ ok: true });
}

export async function saveTargetsAction(input: { targetCostPerFunded?: unknown; contactSlaMinutes?: unknown }): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  const t = num(input.targetCostPerFunded); const s = num(input.contactSlaMinutes);
  if ((t !== null && t <= 0) || (s !== null && (s < 1 || s > 1440))) return { ok: false, error: "Check the numbers." };
  await store.saveTargets({ targetCostPerFunded: t, contactSlaMinutes: s === null ? null : Math.round(s) }, v.id);
  return done({ ok: true });
}
