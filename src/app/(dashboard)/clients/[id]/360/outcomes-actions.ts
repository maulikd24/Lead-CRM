"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { authorizeOutcomes } from "@/lib/outcomes/access";
import { OUTCOME_CONFIG } from "@/lib/outcomes/config";
import { parseGoalInput, parseRef } from "@/lib/outcomes/goal-input";
import { recordOutcomeEvent } from "@/lib/outcomes/events";
import { loadOutcomeBundles } from "@/lib/outcomes/loaders";
import { createOutcomeDraft, taskFromSuggestion } from "@/lib/outcomes/drafts";
import { outcomesDraftDeps } from "@/lib/outcomes/drafts-wiring";
import { safeFirstName } from "@/lib/agents/nudger";
import { createTaskIfNotExists } from "@/lib/stage-engine/create-task-if-not-exists";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const DAY_MS = 86_400_000;
const refresh = (clientId: string) => revalidatePath(`/clients/${clientId}/360`);
const fail = (error: unknown): ActionResult => ({ ok: false, error: error instanceof Error ? error.message : "Something went wrong" });

/** The linked accounts and holdings must belong to this customer. Links are read-only references; nothing about the holdings is changed. */
async function checkLinks(clientId: string, accountIds: string[], holdingKeys: string[]): Promise<string | null> {
  const refs = holdingKeys.map((k) => parseRef(k)!);
  const accounts = [...new Set([...accountIds, ...refs.map((r) => r.accountId)])];
  if (accounts.length === 0) return null;
  const owned = await prisma.tradingAccount.count({ where: { id: { in: accounts }, clientId } });
  return owned === accounts.length ? null : "A linked account does not belong to this customer.";
}

export async function createGoalAction(clientId: string, raw: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { session } = await authorizeOutcomes(clientId, "edit");
    const parsed = parseGoalInput(raw, new Date());
    if (!parsed.ok) return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.errors };
    const g = parsed.value;
    const linkError = await checkLinks(clientId, g.linkedAccountIds, g.linkedHoldingKeys);
    if (linkError) return { ok: false, error: linkError };
    if ((await prisma.customerGoal.count({ where: { clientId, status: { not: "ARCHIVED" } } })) >= 20) return { ok: false, error: "A customer can have at most 20 goals." };
    const goal = await prisma.customerGoal.create({
      data: { clientId, name: g.name, targetAmount: g.targetAmount, targetDate: g.targetDate, priority: g.priority, status: g.status, assumedAnnualRatePct: g.annualRatePct, plannedMonthly: g.plannedMonthly, notes: g.notes, linkedAccountIds: g.linkedAccountIds, linkedHoldingKeys: g.linkedHoldingKeys, createdById: session.user.id, updatedById: session.user.id },
    });
    await recordOutcomeEvent({ clientId, name: "goal_created", actorId: session.user.id, goalId: goal.id, props: { priority: g.priority } });
    refresh(clientId);
    return { ok: true, message: "Goal added." };
  } catch (error) {
    return fail(error);
  }
}

export async function updateGoalAction(clientId: string, goalId: string, raw: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { session } = await authorizeOutcomes(clientId, "edit");
    // The goal must belong to the customer the caller is authorised for: never trust the id alone.
    const existing = await prisma.customerGoal.findFirst({ where: { id: goalId, clientId } });
    if (!existing) return { ok: false, error: "Goal not found." };
    const parsed = parseGoalInput(raw, new Date(), { allowPast: true });
    if (!parsed.ok) return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.errors };
    const g = parsed.value;
    const linkError = await checkLinks(clientId, g.linkedAccountIds, g.linkedHoldingKeys);
    if (linkError) return { ok: false, error: linkError };
    await prisma.customerGoal.update({
      where: { id: goalId },
      data: { name: g.name, targetAmount: g.targetAmount, targetDate: g.targetDate, priority: g.priority, status: g.status, assumedAnnualRatePct: g.annualRatePct, plannedMonthly: g.plannedMonthly, notes: g.notes, linkedAccountIds: g.linkedAccountIds, linkedHoldingKeys: g.linkedHoldingKeys, updatedById: session.user.id },
    });
    await recordOutcomeEvent({ clientId, name: g.status === "ARCHIVED" ? "goal_archived" : "goal_updated", actorId: session.user.id, goalId, props: { status: g.status } });
    refresh(clientId);
    return { ok: true, message: "Goal saved." };
  } catch (error) {
    return fail(error);
  }
}

export async function archiveGoalAction(clientId: string, goalId: string): Promise<ActionResult> {
  try {
    const { session } = await authorizeOutcomes(clientId, "edit");
    const { count } = await prisma.customerGoal.updateMany({ where: { id: goalId, clientId }, data: { status: "ARCHIVED", updatedById: session.user.id } });
    if (count === 0) return { ok: false, error: "Goal not found." };
    await recordOutcomeEvent({ clientId, name: "goal_archived", actorId: session.user.id, goalId });
    refresh(clientId);
    return { ok: true, message: "Goal archived." };
  } catch (error) {
    return fail(error);
  }
}

export async function markReviewedAction(clientId: string, note?: string): Promise<ActionResult> {
  try {
    const { session } = await authorizeOutcomes(clientId, "edit");
    const text = (note ?? "").trim().slice(0, 500);
    await prisma.customerReview.create({ data: { clientId, reviewedById: session.user.id, note: text || null } });
    await recordOutcomeEvent({ clientId, name: "review_marked", actorId: session.user.id });
    refresh(clientId);
    revalidatePath("/dashboard");
    return { ok: true, message: "Review recorded." };
  } catch (error) {
    return fail(error);
  }
}

/** Looks the suggestion up again on the server: the browser only names a rule and a situation, never the task text. */
async function findSuggestion(clientId: string, ruleKey: string, fingerprint: string) {
  const bundle = (await loadOutcomeBundles([clientId])).get(clientId);
  const suggestion = bundle?.suggestions.find((s) => s.ruleKey === ruleKey && s.fingerprint === fingerprint);
  return { bundle, suggestion };
}

export async function dismissSuggestionAction(clientId: string, ruleKey: string, fingerprint: string, reason?: string): Promise<ActionResult> {
  try {
    const { session } = await authorizeOutcomes(clientId, "edit");
    const { suggestion } = await findSuggestion(clientId, ruleKey, fingerprint);
    if (!suggestion) return { ok: false, error: "That suggestion is no longer showing." };
    await prisma.suggestionDismissal.create({
      data: { clientId, ruleKey, fingerprint, reason: (reason ?? "").trim().slice(0, 200) || null, dismissedById: session.user.id, snoozeUntil: new Date(Date.now() + OUTCOME_CONFIG.rules.dismissSnoozeDays * DAY_MS) },
    });
    await recordOutcomeEvent({ clientId, name: "suggestion_dismissed", actorId: session.user.id, props: { ruleKey } });
    refresh(clientId);
    revalidatePath("/dashboard");
    return { ok: true, message: `Dismissed for ${OUTCOME_CONFIG.rules.dismissSnoozeDays} days.` };
  } catch (error) {
    return fail(error);
  }
}

/** The only RM action: a task on the existing task model. Nothing is sent to the customer. */
export async function createSuggestionTaskAction(clientId: string, ruleKey: string, fingerprint: string): Promise<ActionResult> {
  try {
    const { session, client } = await authorizeOutcomes(clientId, "edit");
    const { suggestion } = await findSuggestion(clientId, ruleKey, fingerprint);
    if (!suggestion) return { ok: false, error: "That suggestion is no longer showing." };
    const task = taskFromSuggestion(suggestion, new Date());
    await createTaskIfNotExists({ clientId, assignedToId: client.assignedToId ?? session.user.id, ...task });
    await recordOutcomeEvent({ clientId, name: "task_created", actorId: session.user.id, props: { ruleKey } });
    refresh(clientId);
    revalidatePath("/tasks");
    return { ok: true, message: "Task created." };
  } catch (error) {
    return fail(error);
  }
}

/** Asks for a DRAFT message. It goes to Agent drafts for a person to review; consent and the agent switch are checked first. */
export async function requestSuggestionDraftAction(clientId: string, ruleKey: string, fingerprint: string): Promise<ActionResult> {
  try {
    const { session, client } = await authorizeOutcomes(clientId, "edit");
    const { suggestion } = await findSuggestion(clientId, ruleKey, fingerprint);
    if (!suggestion || !suggestion.draft) return { ok: false, error: "No message draft is available for this suggestion." };
    const result = await createOutcomeDraft({ clientId, firstName: safeFirstName(client.name), template: suggestion.draft, reason: suggestion.title }, outcomesDraftDeps());
    await recordOutcomeEvent({ clientId, name: "draft_requested", actorId: session.user.id, props: { ruleKey, status: result.status } });
    refresh(clientId);
    if (result.status === "drafted") return { ok: true, message: "Draft saved to Agent drafts for review. Nothing has been sent." };
    if (result.status === "blocked") return { ok: false, error: "The draft was held back by the message checks." };
    return { ok: false, error: result.reason === "agent is disabled" ? "Message drafts are switched off." : result.reason === "already has a draft" ? "This customer already has a draft waiting." : "No consent is on record for messaging this customer." };
  } catch (error) {
    return fail(error);
  }
}
