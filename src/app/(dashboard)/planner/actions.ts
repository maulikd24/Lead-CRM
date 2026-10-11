"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { requireMarketing } from "@/lib/auth/require-role";
import { approvalService } from "@/lib/policy/approvals/canonical/wiring";
import * as planner from "@/lib/planner/db";
import { plannerEnabled } from "@/lib/planner/flag";
import { loadRules } from "@/lib/planner/db";
import { previewRouting, type LeadFacts } from "@/lib/planner/routing";
import type { PlanAction } from "@/lib/planner/workflow";

/**
 * Every planner write. Each action: signed in and past the password gate, the central registry grants the area (requireMarketing), the planner flag is on
 * (404 otherwise), and only then the planner's own rules run (they validate everything again: the browser is never trusted). Registry edits (destinations,
 * creators with their SEBI number, routing rules) use the Admin-only registry area. Nothing here publishes, sends or spends: a plan approved here is a
 * recorded intent.
 */
export type ActionResult = { ok: true; id?: string; message?: string } | { ok: false; error: string };
type Input = Record<string, unknown>;

async function manage() {
  const session = await requireMarketing("marketing-planner", "manage");
  if (!plannerEnabled()) notFound();
  return { actor: { id: session.user.id, role: session.user.role as string }, name: session.user.name ?? null };
}
async function manageRegistry() {
  const session = await requireMarketing("marketing-planner-registry", "manage");
  if (!plannerEnabled()) notFound();
  return { actor: { id: session.user.id, role: session.user.role as string }, name: session.user.name ?? null };
}
const obj = (v: unknown): Input => (v && typeof v === "object" && !Array.isArray(v) ? (v as Input) : {});
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const refresh = (id?: string) => {
  revalidatePath("/planner");
  if (id) revalidatePath(`/planner/${id}`);
};
const done = (r: { ok: true; id?: string } | { ok: false; error: string }, message?: string): ActionResult => (r.ok ? { ok: true, id: r.id, message } : { ok: false, error: r.error });

// ---- audiences, promises ----------------------------------------------------------------------------------------------
export async function saveAudienceAction(id: string | null, input: unknown): Promise<ActionResult> {
  await manage();
  const r = await planner.saveAudience(id ? str(id, 40) : null, obj(input) as never);
  refresh();
  return done(r, "Audience saved.");
}
export async function setAudienceArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  await manage();
  const r = await planner.setAudienceArchived(str(id, 40), archived === true);
  refresh();
  return done(r);
}
export async function savePromiseAction(id: string | null, input: unknown): Promise<ActionResult> {
  await manage();
  const r = await planner.savePromise(id ? str(id, 40) : null, obj(input) as never);
  refresh();
  return done(r, "Promise saved.");
}
export async function setPromiseArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  await manage();
  const r = await planner.setPromiseArchived(str(id, 40), archived === true);
  refresh();
  return done(r);
}

// ---- registries (Admin only) ------------------------------------------------------------------------------------------
export async function saveDestinationAction(id: string | null, input: unknown): Promise<ActionResult> {
  await manageRegistry();
  const r = await planner.saveDestination(id ? str(id, 40) : null, obj(input) as never);
  refresh();
  return done(r, "Destination saved.");
}
export async function runHealthChecksAction(): Promise<ActionResult> {
  await manageRegistry();
  const r = await planner.runDestinationHealthChecks();
  refresh();
  return { ok: true, message: `Checked ${r.checked} destination${r.checked === 1 ? "" : "s"}${r.unhealthy ? `, ${r.unhealthy} not healthy` : ", all healthy"}.` };
}
export async function saveCreatorAction(id: string | null, input: unknown): Promise<ActionResult> {
  await manageRegistry();
  const r = await planner.saveCreator(id ? str(id, 40) : null, obj(input) as never);
  refresh();
  return done(r, "Creator saved.");
}
export async function saveRuleAction(id: string | null, input: unknown): Promise<ActionResult> {
  await manageRegistry();
  const r = await planner.saveRule(id ? str(id, 40) : null, obj(input) as never);
  refresh();
  return done(r, "Rule saved.");
}
export async function deleteRuleAction(id: string): Promise<ActionResult> {
  await manageRegistry();
  const r = await planner.deleteRule(str(id, 40));
  refresh();
  return done(r, "Rule deleted.");
}

/** "Test this rule": which rule would own a lead like this? Reads the saved rules and writes nothing. */
export async function previewRoutingAction(input: unknown): Promise<{ ok: true; preview: ReturnType<typeof previewRouting> } | { ok: false; error: string }> {
  await manage();
  const i = obj(input);
  const lead: LeadFacts = { city: str(i.city, 80) || null, language: str(i.language, 40) || null, product: str(i.product, 120) || null, audienceKey: str(i.audienceKey, 40) || null };
  return { ok: true, preview: previewRouting(await loadRules(), lead) };
}

// ---- plans ------------------------------------------------------------------------------------------------------------
export async function createPlanAction(input: unknown): Promise<ActionResult> {
  const { actor } = await manage();
  const r = await planner.createPlan(obj(input) as never, actor);
  refresh();
  return r.ok ? { ok: true, id: r.id, message: `Plan created with campaign code ${r.code}.` } : { ok: false, error: r.error };
}
export async function updatePlanAction(id: string, input: unknown): Promise<ActionResult> {
  const { actor } = await manage();
  const r = await planner.updatePlan(str(id, 40), obj(input) as never, actor);
  refresh(str(id, 40));
  return done(r, "Plan saved. Any approval was withdrawn.");
}
export async function deletePlanAction(id: string): Promise<ActionResult> {
  const { actor } = await manage();
  const r = await planner.deletePlan(str(id, 40), actor);
  refresh();
  return done(r, "Plan deleted.");
}
const FLOW: Record<string, Exclude<PlanAction, "edit" | "approve" | "request_changes">> = { submit: "submit", schedule: "schedule", unschedule: "unschedule" };
/** Send for review, schedule or unschedule. Approving and asking for changes go through the canonical approval service (decidePlanAction). */
export async function planFlowAction(id: string, action: string): Promise<ActionResult> {
  const { actor } = await manage();
  const step = FLOW[action];
  if (!step) return { ok: false, error: "That action does not exist." };
  const r = await planner.transitionPlan(str(id, 40), step, actor);
  refresh(str(id, 40));
  return done(r, step === "submit" ? "Sent for review." : step === "schedule" ? "Scheduled. Dates are recorded; nothing is published." : "Back to approved.");
}
/** Approve or send back: ONE decision path, the canonical approval service (four-eyes, checklist re-run, the reader's tick, audit). */
export async function decidePlanAction(id: string, decision: string, input: unknown): Promise<ActionResult> {
  const { actor, name } = await manage();
  if (decision !== "approve" && decision !== "reject") return { ok: false, error: "That action does not exist." };
  const i = obj(input);
  const res = await approvalService().decide({ id: actor.id, role: actor.role as never, name }, `planner-plan:${str(id, 40)}`, decision, { reason: str(i.reason, 500) || null, params: { confirmed: i.confirmed === true } });
  refresh(str(id, 40));
  return res.ok ? { ok: true, message: decision === "approve" ? "Approved." : "Sent back to draft with your note." } : { ok: false, error: res.error };
}
export async function setLinksTestedAction(id: string, tested: boolean): Promise<ActionResult> {
  const { actor } = await manage();
  const r = await planner.setLinksTested(str(id, 40), tested === true, actor);
  refresh(str(id, 40));
  return done(r, tested ? "Marked as tested." : "Test mark removed.");
}

// ---- copy drafts ------------------------------------------------------------------------------------------------------
export async function addCopyAction(planId: string, input: unknown): Promise<ActionResult> {
  const { actor } = await manage();
  const r = await planner.addCopy(str(planId, 40), obj(input).body, actor);
  refresh(str(planId, 40));
  return done(r, "Draft added with its disclaimer.");
}
export async function editCopyAction(planId: string, copyId: string, input: unknown): Promise<ActionResult> {
  const { actor } = await manage();
  const r = await planner.editCopy(str(copyId, 40), obj(input).body, actor);
  refresh(str(planId, 40));
  return done(r, "Draft saved.");
}
export async function copyReviewAction(planId: string, copyId: string, action: string, input: unknown): Promise<ActionResult> {
  const { actor } = await manage();
  if (action !== "submit" && action !== "approve" && action !== "request_changes") return { ok: false, error: "That action does not exist." };
  const r = await planner.copyAction(str(copyId, 40), action, actor, { confirmed: obj(input).confirmed === true });
  refresh(str(planId, 40));
  return done(r, action === "submit" ? "Sent for review." : action === "approve" ? "Copy approved." : "Sent back to draft.");
}
export async function deleteCopyAction(planId: string, copyId: string): Promise<ActionResult> {
  await manage();
  const r = await planner.deleteCopy(str(copyId, 40));
  refresh(str(planId, 40));
  return done(r, "Draft deleted.");
}
export async function aiDraftCopyAction(planId: string): Promise<ActionResult> {
  const { actor } = await manage();
  const r = await planner.aiDraftCopy(str(planId, 40), actor);
  refresh(str(planId, 40));
  return done(r, "AI draft added. It is a draft only: a person must review it.");
}
