import { COOLDOWN_WINDOWS_MS } from "./cooldown";
import { ENV_FLAG_BY_AGENT } from "./enabled";
import { DRAFT_TTL_MS } from "./nudger";

const DAY = 86_400_000;

/** The agents with a kill switch, in the order the Rules tab lists them. */
export const AGENT_CATALOGUE = [
  { key: "wa_nudger", label: "WhatsApp nudger", blurb: "Drafts a follow-up for customers who are stuck in onboarding. Drafts wait on the Drafts to review tab." },
  { key: "wa_reply", label: "Reply assistant", blurb: "Suggests an answer inside the Inbox when a customer writes in. The RM presses Send." },
  { key: "outcomes_review", label: "Goals and outcomes drafter", blurb: "Drafts a short review or check-in message from a fixed template when the relationship manager asks for one. Drafts wait on the Drafts to review tab." },
] as const;

export type AgentKey = (typeof AGENT_CATALOGUE)[number]["key"];

/** Same rule as `agentEnabled` (src/lib/agents/enabled.ts), but synchronous and showing both halves, so the page can say which switch is off. */
export function agentStatus(agentKey: string, env: Record<string, string | undefined>, row: { enabled: boolean } | null) {
  const flag = ENV_FLAG_BY_AGENT[agentKey];
  const envOn = !!flag && env[flag] === "1";
  const rowOn = row?.enabled === true;
  return { envOn, rowOn, running: envOn && rowOn };
}

export function envFlagFor(agentKey: string): string | undefined {
  return ENV_FLAG_BY_AGENT[agentKey];
}

export type SetEnabledInput = { ok: true; agentKey: AgentKey; enabled: boolean } | { ok: false; error: string };

export function parseSetEnabledInput(agentKey: unknown, enabled: unknown): SetEnabledInput {
  const known = AGENT_CATALOGUE.find((a) => a.key === agentKey);
  if (!known || typeof enabled !== "boolean") return { ok: false, error: "Invalid request" };
  return { ok: true, agentKey: known.key, enabled };
}

const days = (ms: number) => `${Math.round(ms / DAY)} days`;

/** The rules the agents run under, in plain words, built from the constants the code uses so this list cannot drift. */
export function ruleLines(): string[] {
  return [
    "Nothing is sent until a person approves that specific message. An approver can edit the text first.",
    "Only the assigned RM or an Admin can approve or reject. Managers see the drafts but cannot act on them.",
    `A draft that is not decided expires after ${Math.round(DRAFT_TTL_MS / 3_600_000)} hours and is never sent.`,
    "Every draft passes a pattern check and an AI judge before anyone sees it. A draft that fails is discarded, and its text is not shown.",
    `After a nudge is sent the customer is left alone for ${days(COOLDOWN_WINDOWS_MS.SENT)}; after a rejection ${days(COOLDOWN_WINDOWS_MS.REJECTED)}; after a blocked draft ${days(COOLDOWN_WINDOWS_MS.BLOCKED)}.`,
    "An agent runs only when both switches are on: the environment flag and the kill switch below. Turning either off stops new drafts at once.",
  ];
}
