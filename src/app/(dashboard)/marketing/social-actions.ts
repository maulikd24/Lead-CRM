"use server";

import { revalidatePath } from "next/cache";

import { agentEnabled } from "@/lib/agents/enabled";
import { getProvider } from "@/lib/ai/provider";
import { requireRole } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { socialDraftsEnabled } from "@/lib/marketing/flags";
import { AI_DRAFTER_KEY, draftPostWithAi } from "@/lib/marketing/social/ai-draft";
import type { ComplianceIssue } from "@/lib/marketing/social/compliance";
import { socialTimezone } from "@/lib/marketing/social/config";
import { socialService } from "@/lib/marketing/social/store";
import { zonedLocalToUtc } from "@/lib/marketing/zoned-time";
import type { PostAction } from "@/lib/marketing/social/workflow";

/**
 * Server actions for social post drafts. Every one re-checks the flag and the role on the server, never trusts what
 * the browser sent about status, and none of them publishes anything: the furthest a post can go is Scheduled.
 */

export type ActionResult = { ok: true; id?: string; message?: string } | { ok: false; error: string; issues?: ComplianceIssue[] };

const OFF: ActionResult = { ok: false, error: "Social drafts are switched off on this server." };
const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

async function gate() {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (!socialDraftsEnabled()) return null;
  return { id: session.user.id, role: session.user.role as string };
}

const done = (r: { ok: true; post: { id: string } } | { ok: false; error: string; issues?: ComplianceIssue[] }): ActionResult => {
  revalidatePath("/marketing");
  return r.ok ? { ok: true, id: r.post.id } : { ok: false, error: r.error, issues: r.issues };
};

export async function createDraftAction(input: { channel: unknown; title?: unknown; body: unknown }): Promise<ActionResult> {
  const actor = await gate();
  if (!actor) return OFF;
  return done(await socialService().createDraft({ channel: text(input.channel, 20), title: text(input.title, 200), body: text(input.body, 20_000), actor, source: "STAFF" }));
}

export async function saveDraftAction(id: unknown, input: { channel: unknown; title?: unknown; body: unknown }): Promise<ActionResult> {
  const actor = await gate();
  if (!actor) return OFF;
  return done(await socialService().editPost(text(id, 64), { channel: text(input.channel, 20), title: text(input.title, 200), body: text(input.body, 20_000), actor }));
}

const ACTIONS: Exclude<PostAction, "edit">[] = ["submit", "approve", "request_changes", "schedule", "unschedule"];

export async function transitionAction(id: unknown, action: unknown, input: { confirmed?: unknown; note?: unknown; scheduledLocal?: unknown } = {}): Promise<ActionResult> {
  const actor = await gate();
  if (!actor) return OFF;
  if (!ACTIONS.includes(action as never)) return { ok: false, error: "That action does not exist." };
  const scheduledFor = action === "schedule" ? zonedLocalToUtc(text(input.scheduledLocal, 20), socialTimezone()) : null;
  return done(await socialService().transition(text(id, 64), action as Exclude<PostAction, "edit">, { actor, confirmed: input.confirmed === true, note: text(input.note, 500), scheduledFor }));
}

export async function discardDraftAction(id: unknown): Promise<ActionResult> {
  const actor = await gate();
  if (!actor) return OFF;
  const res = await socialService().discardDraft(text(id, 64), actor);
  revalidatePath("/marketing");
  return res.ok ? { ok: true } : res;
}

function aiDeps() {
  return { provider: getProvider(), isEnabled: () => agentEnabled(AI_DRAFTER_KEY, process.env, (key) => prisma.agentSetting.findUnique({ where: { agentKey: key }, select: { enabled: true } })) };
}

const AI_REASON: Record<string, string> = {
  disabled: "AI drafting is switched off.",
  invalid: "Check the brief and the channel.",
  unavailable: "The AI service could not be reached. Nothing was drafted.",
  no_draft: "The AI did not produce a draft. Try rewording the brief.",
  unsafe: "The draft did not pass the compliance checks, so it was not kept.",
};

export async function aiDraftAction(input: { brief: unknown; channel: unknown }): Promise<ActionResult> {
  const actor = await gate();
  if (!actor) return OFF;
  const brief = text(input.brief, 600);
  const channel = text(input.channel, 20);
  const draft = await draftPostWithAi({ brief, channel }, aiDeps());
  if (!draft.ok) return { ok: false, error: draft.detail && draft.reason !== "disabled" && draft.reason !== "unavailable" ? `${AI_REASON[draft.reason]} ${draft.detail}` : AI_REASON[draft.reason] };
  const created = await socialService().createDraft({ channel, title: null, body: draft.body, actor, source: "AI", brief: brief.trim() });
  return done(created);
}

/** The AI drafter's own kill switch (an Admin only), in addition to the SOCIAL_DRAFTS_ENABLED environment flag. */
export async function setAiDrafterAction(enabled: unknown): Promise<ActionResult> {
  const session = await requireRole(["ADMIN"]);
  if (!socialDraftsEnabled()) return OFF;
  const on = enabled === true;
  await prisma.agentSetting.upsert({ where: { agentKey: AI_DRAFTER_KEY }, create: { agentKey: AI_DRAFTER_KEY, enabled: on, updatedById: session.user.id }, update: { enabled: on, updatedById: session.user.id } });
  revalidatePath("/marketing");
  return { ok: true, message: on ? "AI drafting is on." : "AI drafting is off." };
}
