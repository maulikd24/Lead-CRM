"use server";

import { revalidatePath } from "next/cache";

import { answer, planByKeywords, planWithModel, type Answer } from "@/lib/autopilot/ask";
import { ensureFreshAudit } from "@/lib/autopilot/audit-db";
import { decideDigestNow } from "@/lib/autopilot/digest-db";
import { applyApproved } from "@/lib/autopilot/decisions";
import { decisionDeps } from "@/lib/autopilot/decisions-wiring";
import { DENY_REASONS } from "@/lib/autopilot/recommendations";
import { draftRuleFromText, type RuleDraft } from "@/lib/autopilot/rule-draft";
import { approvalService } from "@/lib/policy/approvals/canonical/wiring";
import { requireMarketing } from "@/lib/auth/require-role";
import type { OutcomeCaller } from "@/lib/attribution";
import { autopilotAskEnabled, autopilotPageEnabled } from "@/lib/autopilot/flags";
import { buildLaunchDraft, type LaunchInput } from "@/lib/autopilot/launch";
import { getActionProvider } from "@/lib/autopilot/provider";
import { RULE_METRICS, previewRule, validateRule, type Rule, type RulePreview } from "@/lib/autopilot/rules";
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

/** The one gate: the central registry (area marketing-autopilot, ADMIN and MARKETING only) through requireMarketing. The feature flag comes second. */
async function gate(action: "view" | "manage" = "manage") {
  const session = await requireMarketing("marketing-autopilot", action);
  if (!autopilotPageEnabled()) return null;
  const caller: OutcomeCaller = { kind: "user", id: session.user.id, role: session.user.role };
  return { id: session.user.id, role: session.user.role, caller };
}
const done = <T>(r: Result<T>): Result<T> => { revalidatePath("/autopilot"); return r; };

/**
 * Approve or deny a proposal through the CANONICAL approval service (kind autopilot-action): it decides who may act (ADMIN and MARKETING), four eyes when
 * Settings turn it on, the reason a denial needs, the expiry, and writes the audit row, then calls the legacy decision path unchanged. Approving never touches
 * an ad account; applying is a second, explicit act below.
 */
export async function decideAction(recId: unknown, verdict: unknown, input: { reasonCode?: unknown; note?: unknown } = {}): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  if (verdict !== "approve" && verdict !== "deny") return { ok: false, error: "Unknown decision." };
  const id = text(recId, 200);
  if (!id) return { ok: false, error: "That proposal no longer exists." };
  const code = DENY_REASONS.find((r) => r.code === text(input.reasonCode, 40))?.code;
  const note = text(input.note, 500);
  if (verdict === "deny" && !code) return { ok: false, error: "Choose a reason for denying." };
  const reason = verdict === "deny" ? (note || DENY_REASONS.find((r) => r.code === code)?.label || "") : "";
  const res = await approvalService().decide({ id: v.id, role: v.role as never }, `autopilot-action:${id}`, verdict === "approve" ? "approve" : "reject", { reason, params: { reasonCode: code } });
  if (!res.ok) return { ok: false, error: res.error };
  return done({ ok: true });
}

/** The second explicit human act: apply an APPROVED proposal to the ad account. Needs the canonical state to be approved, applying switched on (blocked by default) and a database claim so it happens once. */
export async function applyRecommendationAction(recId: unknown): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  const id = text(recId, 200);
  const item = await approvalService().get({ id: v.id, role: v.role as never }, `autopilot-action:${id}`);
  if (!item) return { ok: false, error: "That proposal no longer exists." };
  if (item.state !== "approved") return { ok: false, error: "A person must approve this proposal first." };
  const res = await applyApproved(decisionDeps(), { recId: id, actorId: v.id });
  if (!res.ok) return res;
  return done({ ok: true });
}

export async function askAutopilotAction(question: unknown): Promise<Result<{ answer: Answer }>> {
  const v = await gate("view"); if (!v) return OFF;
  if (!autopilotAskEnabled()) return { ok: false, error: "Ask Autopilot is switched off on this server." };
  const q = text(question, 500);
  if (q.length < 3) return { ok: false, error: "Type a question." };
  const snap = await store.loadSnapshot({ caller: v.caller });
  // The model, through the AI gateway, only chooses read-only tools; a blocked or failed call falls back to the keyword router.
  const calls = await planWithModel(q, snap.campaigns.map((c) => c.name));
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
  const v = await gate("view"); if (!v) return OFF;
  return { ok: true, draft: buildLaunchDraft(launchInput(raw), await store.loadSnapshot({ caller: v.caller })) };
}

export async function saveLaunchDraftAction(raw: Record<string, unknown>): Promise<Result<{ id: string }>> {
  const v = await gate(); if (!v) return OFF;
  const draft = buildLaunchDraft(launchInput(raw), await store.loadSnapshot({ caller: v.caller }));
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

function ruleFrom(raw: Record<string, unknown>): Partial<Rule> {
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 120).slice(0, 200) : []);
  const campaignIds = ids(raw.campaignIds); const accountIds = ids(raw.accountIds);
  return { name: text(raw.name, 80), metric: text(raw.metric, 40) as Rule["metric"], op: raw.op === "<" ? "<" : ">", threshold: num(raw.threshold) ?? NaN, days: num(raw.days) ?? 0, action: text(raw.action, 40) as Rule["action"], enabled: true, campaignIds: campaignIds.length ? campaignIds : null, accountIds: accountIds.length ? accountIds : null };
}

export async function saveRuleAction(raw: Record<string, unknown>): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  const rule = ruleFrom(raw);
  if (!(rule.metric! in RULE_METRICS)) return { ok: false, error: "Pick a measure." };
  const err = validateRule(rule); if (err) return { ok: false, error: err };
  await store.saveRule(rule as Omit<Rule, "id">, v.id, raw.drafted === true ? "drafted" : "manual");
  return done({ ok: true });
}

/** Natural-language rule drafting: a DRAFT for the form, through the AI gateway. It saves nothing and the rule it describes would only ever propose. */
export async function draftRuleAction(sentence: unknown): Promise<Result<{ rule: RuleDraft; note: string }>> {
  const v = await gate("view"); if (!v) return OFF;
  if (!autopilotAskEnabled()) return { ok: false, error: "Rule drafting is switched off on this server. Write the rule by hand." };
  const snap = await store.loadSnapshot({ caller: v.caller });
  const r = await draftRuleFromText(text(sentence, 600), { campaigns: snap.campaigns.map((c) => ({ id: c.id, name: c.name, accountId: c.accountId })) });
  return r.ok ? { ok: true, rule: r.rule, note: r.note } : { ok: false, error: r.message };
}

/** What a rule would do against today's data, before it is saved. Changes nothing (see the simulate() seam in lib/autopilot/rules.ts). */
export async function previewRuleAction(raw: Record<string, unknown>): Promise<Result<{ preview: RulePreview }>> {
  const v = await gate("view"); if (!v) return OFF;
  const rule = ruleFrom(raw);
  if (!(rule.metric! in RULE_METRICS)) return { ok: false, error: "Pick a measure." };
  const days = Number.isInteger(rule.days) ? (rule.days as number) : 0;
  const snap = await store.loadSnapshot({ caller: v.caller, ruleWindows: days >= 1 && days <= 90 ? [days] : [] });
  return { ok: true, preview: previewRule(snap, rule as Omit<Rule, "id">) };
}

/** Four eyes for rule-made proposals: when on, the person who wrote a rule cannot approve what it proposes. Off by default. */
export async function saveSecondApproverAction(on: unknown): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  await store.saveSecondApprover(on === true, v.id);
  return done({ ok: true });
}

/** The weekly digest email is a DRAFT until a person approves it here; only then is it sent, to Admin and Marketing users. */
export async function decideDigestAction(id: unknown, verdict: unknown): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  if (verdict !== "approve" && verdict !== "discard") return { ok: false, error: "Unknown decision." };
  const res = await decideDigestNow({ id: text(id, 64), actorId: v.id, verdict });
  return res.ok ? done({ ok: true }) : res;
}

/** Runs the audit now (the page does this on its own when the newest one is old). */
export async function refreshAuditAction(): Promise<Result> {
  const v = await gate(); if (!v) return OFF;
  await ensureFreshAudit({ force: true, startedById: v.id });
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
