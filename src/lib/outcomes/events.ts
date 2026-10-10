import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Outcome events: what people did with goals and suggestions, kept in this database for internal reporting.
 * They are NEVER sent to any third-party service (no integration import and no network call in this module).
 * `props` holds only short ids, numbers and flags from an allowed list, so a name, an amount or a note can never end up in it.
 */
export const OUTCOME_EVENT_NAMES = ["goal_created", "goal_updated", "goal_archived", "review_marked", "suggestion_dismissed", "task_created", "draft_requested"] as const;
export type OutcomeEventName = (typeof OUTCOME_EVENT_NAMES)[number];

const ALLOWED_PROP_KEYS = new Set(["ruleKey", "status", "count", "kind", "priority", "band", "source"]);
const MAX_STRING = 40;

export function sanitizeEventProps(props: Record<string, unknown> | undefined): Record<string, string | number | boolean> | null {
  if (!props) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!ALLOWED_PROP_KEYS.has(key)) continue;
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) out[key] = value;
    else if (typeof value === "string" && value.length <= MAX_STRING) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Best effort: reporting must never break the action it describes. */
export async function recordOutcomeEvent(input: { clientId: string; name: OutcomeEventName; actorId?: string | null; goalId?: string | null; props?: Record<string, unknown> }): Promise<void> {
  try {
    const props = sanitizeEventProps(input.props);
    await prisma.outcomeEvent.create({ data: { clientId: input.clientId, name: input.name, actorId: input.actorId ?? null, goalId: input.goalId ?? null, ...(props ? { props: props as Prisma.InputJsonValue } : {}) } });
  } catch (error) {
    console.error("outcome event not recorded", error instanceof Error ? error.name : "unknown");
  }
}
