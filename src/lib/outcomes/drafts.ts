import { checkOutbound } from "@/lib/agents/guardrails";

import { DAY_MS } from "./cadence";
import { renderDraft, type DraftTemplateKey } from "./copy";
import type { Suggestion } from "./types";

/**
 * Suggested messages and tasks from the outcomes rules.
 *
 *  - A message is only ever a DRAFT proposal on the existing draft-only path: written from a fixed template (no model
 *    is called), checked by the same outbound guardrails, held back by the consent gate, and reviewed and approved by a
 *    person on Agent drafts. Nothing is sent from here.
 *  - A task is the only other action, created on the existing task model for the customer's RM.
 */

export const OUTCOMES_AGENT_KEY = "outcomes_review";
export const DRAFT_TTL_MS = 48 * 60 * 60 * 1000;

export type NewOutcomeProposal = {
  agentKey: typeof OUTCOMES_AGENT_KEY;
  clientId: string;
  programme: string;
  body: string;
  originalBody: string;
  reason: string;
  status: "DRAFT" | "BLOCKED";
  blockedReason: string | null;
  provider: "rules";
  model: "template-v1";
  inputTokens: 0;
  outputTokens: 0;
  expiresAt: Date;
};

export type DraftDeps = {
  /** The agent switch (env flag and kill-switch row). */
  isEnabled: () => Promise<boolean>;
  /** The consent gate: allowed unless consent enforcement is on and the customer has not agreed. */
  consent: (clientId: string) => Promise<{ allowed: boolean; reason?: string }>;
  hasOpenDraft: (clientId: string) => Promise<boolean>;
  save: (proposal: NewOutcomeProposal) => Promise<{ id: string }>;
  now: () => Date;
};

export type DraftOutcome = { status: "skipped"; reason: string } | { status: "blocked"; reason: string; proposalId: string } | { status: "drafted"; proposalId: string };

export async function createOutcomeDraft(input: { clientId: string; firstName: string; template: DraftTemplateKey; reason: string }, deps: DraftDeps): Promise<DraftOutcome> {
  if (!(await deps.isEnabled())) return { status: "skipped", reason: "agent is disabled" };
  const gate = await deps.consent(input.clientId);
  if (!gate.allowed) return { status: "skipped", reason: gate.reason ?? "no consent" };
  if (await deps.hasOpenDraft(input.clientId)) return { status: "skipped", reason: "already has a draft" };

  const body = renderDraft(input.template, input.firstName);
  const verdict = checkOutbound(body);
  const proposal: NewOutcomeProposal = {
    agentKey: OUTCOMES_AGENT_KEY, clientId: input.clientId, programme: "Outcomes review", body, originalBody: body, reason: input.reason,
    status: verdict.ok ? "DRAFT" : "BLOCKED", blockedReason: verdict.ok ? null : `${verdict.code}: ${verdict.detail}`,
    provider: "rules", model: "template-v1", inputTokens: 0, outputTokens: 0, expiresAt: new Date(deps.now().getTime() + DRAFT_TTL_MS),
  };
  const saved = await deps.save(proposal);
  return verdict.ok ? { status: "drafted", proposalId: saved.id } : { status: "blocked", reason: verdict.detail, proposalId: saved.id };
}

export function taskFromSuggestion(s: Suggestion, now: Date): { title: string; dueAt: Date; source: string } {
  return { title: s.task.title, dueAt: new Date(now.getTime() + s.task.dueInDays * DAY_MS), source: `outcomes:${s.ruleKey}:${s.fingerprint}`.slice(0, 120) };
}
