import type { InteractionOutcomeType } from "@/generated/prisma/client";
import type { RecordOutcomeInput } from "@/lib/intelligence/outcomes";

/**
 * Conversation outcome capture (AI execution layer, bible 08). Every bot conversation ends with one structured outcome. This module
 * does not store anything itself: it validates the outcome and hands it to the EXISTING outcome path (intelligence/outcomes.ts,
 * recordInteractionOutcome), which writes the outcome, creates the follow-up, and refreshes acceptance and the next best action.
 *
 * The bible lists these outcomes. "Not Relevant" appears twice in the bible's list; there are seven distinct outcomes.
 */
export const CONVERSATION_OUTCOMES = [
  { label: "Interested", value: "INTERESTED" },
  { label: "Not Interested", value: "NOT_INTERESTED" },
  { label: "Follow Up", value: "FOLLOW_UP" },
  { label: "RM Handover", value: "RM_HANDOVER" },
  { label: "Converted", value: "CONVERTED" },
  { label: "Service Issue", value: "SERVICE_ISSUE" },
  { label: "Not Relevant", value: "NOT_RELEVANT" },
] as const satisfies readonly { label: string; value: InteractionOutcomeType }[];

export type ConversationOutcome = (typeof CONVERSATION_OUTCOMES)[number]["value"];

export type CaptureOutcomeInput = {
  clientId: string;
  outcome: ConversationOutcome;
  channel: string;
  actorType: "AI_AGENT" | "RM";
  actorId?: string | null;
  assetClass?: string | null;
  programme?: string | null;
  note?: string | null;
  /** RM_HANDOVER: what the RM needs to know to take over. Required for a handover. */
  summary?: string | null;
  followUpAt?: Date | null;
};

/** The outcome for a label as written in the bible ("Follow Up", "RM Handover"...), or null when it is not one of them. */
export function outcomeFromLabel(label: string): ConversationOutcome | null {
  const wanted = label.trim().toLowerCase();
  return CONVERSATION_OUTCOMES.find((o) => o.label.toLowerCase() === wanted)?.value ?? null;
}

export type CaptureDeps = {
  /** The existing outcome path. Production passes recordInteractionOutcome; tests pass a fake. */
  record: (input: RecordOutcomeInput) => Promise<unknown>;
};

export async function captureConversationOutcome(input: CaptureOutcomeInput, deps: CaptureDeps): Promise<unknown> {
  if (!input.clientId) throw new Error("A conversation outcome needs a customer");
  if (!CONVERSATION_OUTCOMES.some((o) => o.value === input.outcome)) throw new Error(`Unknown conversation outcome: ${String(input.outcome)}`);
  if (input.outcome === "RM_HANDOVER" && !input.summary?.trim()) throw new Error("An RM handover needs a summary for the RM");
  if (input.outcome === "SERVICE_ISSUE" && !input.note?.trim()) throw new Error("A service issue needs a note describing it");
  return deps.record({ ...input, channel: input.channel || "AI_BOT" });
}
