/**
 * AI-assisted quality detectors for the bible's remaining flags (section 04): incorrect communication, poor conversation,
 * missed opportunity and potential compliance issue. Each detector reads ONE stored WhatsApp thread or call transcript
 * (ConversationReview.transcript), asks the model one question through callModel() with the purpose "audit.flags", and
 * returns at most one AuditFinding draft. A detector never writes to a customer and never stores the text it read.
 *
 * Rules:
 * - Text that is not stored is never sent: a review with no transcript returns nothing and makes no call.
 * - No AI key means the whole AI pass is skipped (reported as skipped, not failed).
 * - Consent is enforced by the gateway (purpose AI_PROCESSING_OF_CHATS, subject = the customer). A consent refusal is "blocked".
 * - The model's summary is a short, single-line sentence, capped in length. The transcript is never copied into a finding.
 * - The model is injected (CallFn) so the rules are unit-tested with a stub. Production passes the real callModel.
 */
import { z } from "zod";

import type { ToolDef } from "@/lib/ai/provider";
import type { CallInput, GatewayResult } from "@/lib/ai/gateway/types";

import type { FindingCategory, FindingDraft, FindingSeverity, FindingSource } from "./findings";

export const AI_PURPOSE_ID = "audit.flags";
export const AI_FLAG_CATEGORIES = ["INCORRECT_COMMUNICATION", "POOR_CONVERSATION", "MISSED_OPPORTUNITY", "POTENTIAL_COMPLIANCE_ISSUE"] as const satisfies readonly FindingCategory[];
export type AiFlagCategory = (typeof AI_FLAG_CATEGORIES)[number];

const TOOL_NAME = "submit_quality_flag";
const MAX_TRANSCRIPT_CHARS = 12_000;
const SUMMARY_MAX_CHARS = 200;

const BRIEF: Record<AiFlagCategory, string> = {
  INCORRECT_COMMUNICATION: "Did the RM give wrong, misleading or unsupported information (product terms, fees, returns, eligibility, dates)? Flag only clear errors.",
  POOR_CONVERSATION: "Was the exchange dismissive, rushed, rude, or did it ignore the customer's question? Flag only clear cases.",
  MISSED_OPPORTUNITY: "Did the customer show clear interest or a next step (wants to invest, asked for a callback, mentioned money to deploy) that the RM did not take up?",
  POTENTIAL_COMPLIANCE_ISSUE: "Is there a possible regulatory concern: a return or performance promise, pressure to invest, a missing risk statement, or sharing of private data? This is for a person to check; it is not a finding of breach.",
};

const flagSchema = z.object({
  flagged: z.boolean(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  summary: z.string(),
});

/** One stored conversation the detectors may read. `transcript` is the text already in the database. */
export type ReviewText = {
  id: string;
  clientId: string;
  sourceType: "CALL" | "WHATSAPP_THREAD";
  assignedRmId: string | null;
  transcript: string;
};

/** The gateway entry point. Production uses callModel; tests pass a stub. */
export type CallFn = (input: CallInput) => Promise<GatewayResult>;

export type DetectorOutcome = "flagged" | "clear" | "abstained" | "blocked" | "failed";

export type DetectorResult = { category: AiFlagCategory; outcome: DetectorOutcome; draft?: FindingDraft };

const sourceOf = (sourceType: ReviewText["sourceType"]): FindingSource => (sourceType === "CALL" ? "CALL" : "WHATSAPP");

export function buildDetectorTool(): ToolDef {
  return {
    name: TOOL_NAME,
    description: "Submit whether the conversation shows the condition asked about. Only the flag, a severity and a one-line summary.",
    inputSchema: {
      type: "object" as const,
      properties: {
        flagged: { type: "boolean" },
        severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
        summary: { type: "string", description: "One short sentence describing the condition. No quotes, no names, no phone numbers, no account numbers." },
      },
      required: ["flagged", "severity", "summary"],
    },
  } as ToolDef;
}

export function buildDetectorPrompt(category: AiFlagCategory, transcript: string, truncated: boolean): string {
  return `You are a quality-audit assistant for a wealth-management distribution firm. Read the stored conversation between a Relationship Manager (RM) and a customer. Answer one question only:
${BRIEF[category]}

If the conversation does not show this, set flagged to false. Do not guess. Ordinary conversation is not a flag.
Call the ${TOOL_NAME} tool. The summary is one short sentence about the condition. Never quote the conversation. Never include names, phone numbers, email addresses or account numbers.
${truncated ? "Note: only the most recent part of the conversation is shown.\n" : ""}
Conversation:
"""
${transcript}
"""`;
}

/** Runs one detector over one stored conversation. Makes one model call, or none when the text is empty. */
export async function runAiDetector(category: AiFlagCategory, review: ReviewText, call: CallFn, now: Date): Promise<DetectorResult> {
  if (review.transcript.trim().length === 0) return { category, outcome: "clear" };
  const truncated = review.transcript.length > MAX_TRANSCRIPT_CHARS;
  const text = truncated ? review.transcript.slice(-MAX_TRANSCRIPT_CHARS) : review.transcript;
  const result = await call({
    purpose: "audit.flags",
    user: buildDetectorPrompt(category, text, truncated),
    tools: [buildDetectorTool()],
    toolChoice: { name: TOOL_NAME },
    maxTokens: 300,
    subject: { type: "client", id: review.clientId },
  });
  if (result.kind === "abstain") return { category, outcome: "abstained" };
  if (result.kind === "blocked") return { category, outcome: "blocked" };
  if (result.kind === "failed") return { category, outcome: "failed" };

  const use = result.toolUses.find((t) => t.name === TOOL_NAME);
  const parsed = flagSchema.safeParse(use?.input);
  if (!parsed.success) return { category, outcome: "failed" };
  if (!parsed.data.flagged) return { category, outcome: "clear" };

  const severity: FindingSeverity = parsed.data.severity;
  const summary = parsed.data.summary.replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX_CHARS);
  const source = sourceOf(review.sourceType);
  return {
    category,
    outcome: "flagged",
    draft: {
      dedupeKey: `${source}:${review.id}:${category}`,
      clientId: review.clientId,
      subjectUserId: review.assignedRmId,
      source,
      category,
      severity,
      summary,
      evidenceRef: `review:${review.id}`,
      detectedAt: now,
    },
  };
}

export type AiBatch =
  | { skipped: "no_ai_key" }
  | {
      skipped?: undefined;
      reviewsSeen: number;
      /** Reviews where every detector reached a final outcome (flagged, clear, abstained or blocked). Safe to mark as scanned. */
      scannedReviewIds: string[];
      drafts: FindingDraft[];
      counts: Record<DetectorOutcome, number>;
    };

/**
 * Runs every AI detector over the given reviews, one review at a time. `hasKey` false returns "skipped" with no call made.
 * `shouldStop` is checked before each review so a slow model can never run past the job's time budget.
 * A review with any transient failure is NOT marked scanned, so the next run retries it.
 */
export async function runAiDetectors(input: {
  reviews: readonly ReviewText[];
  call: CallFn;
  hasKey: boolean;
  now: Date;
  shouldStop?: () => boolean;
  categories?: readonly AiFlagCategory[];
}): Promise<AiBatch> {
  if (!input.hasKey) return { skipped: "no_ai_key" };
  const categories = input.categories ?? AI_FLAG_CATEGORIES;
  const counts: Record<DetectorOutcome, number> = { flagged: 0, clear: 0, abstained: 0, blocked: 0, failed: 0 };
  const scannedReviewIds: string[] = [];
  const drafts: FindingDraft[] = [];
  let reviewsSeen = 0;

  for (const review of input.reviews) {
    if (input.shouldStop?.()) break;
    if (review.transcript.trim().length === 0) continue;
    reviewsSeen += 1;
    let reviewFailed = false;
    for (const category of categories) {
      const r = await runAiDetector(category, review, input.call, input.now);
      counts[r.outcome] += 1;
      if (r.outcome === "failed") reviewFailed = true;
      if (r.draft) drafts.push(r.draft);
    }
    if (!reviewFailed) scannedReviewIds.push(review.id);
  }
  return { reviewsSeen, scannedReviewIds, drafts, counts };
}
