import { getAnthropicClient, isAnthropicConfigured } from "@/lib/ai/client";
import { conversationAnalysisSchema, type ConversationAnalysis } from "@/lib/ai/schema";
import { QUALITY_RUBRIC } from "@/lib/ai/quality-rubric";

// Capped to keep token cost bounded and predictable — WhatsApp threads can run up to 300 messages
// (THREAD_LIMIT in src/lib/whatsapp/inbox-queries.ts) and call transcripts can be arbitrarily long.
// Tail-truncate (keep the most recent content) since the end of a conversation usually carries the
// outcome/next-steps that matter most for scoring.
const MAX_TRANSCRIPT_CHARS = 12_000;

export const ANALYSIS_MODEL = "claude-sonnet-5-5";

const ANALYSIS_TOOL_NAME = "submit_conversation_analysis";

function buildRubricDescription(): string {
  return QUALITY_RUBRIC.map((c) => `- ${c.key} (max ${c.maxScore}): ${c.label} — ${c.description}`).join("\n");
}

function buildPrompt(transcript: string, sourceType: "CALL" | "WHATSAPP_THREAD", truncated: boolean): string {
  const kind = sourceType === "CALL" ? "phone call transcript" : "WhatsApp conversation thread";
  return `You are a quality-audit assistant for a wealth-management distribution firm. Review the following ${kind} between a Relationship Manager (RM) and a client, then score it against this fixed rubric:

${buildRubricDescription()}

${truncated ? "Note: this transcript has been truncated to the most recent portion — score only what is shown.\n\n" : ""}Transcript:
"""
${transcript}
"""

Call the ${ANALYSIS_TOOL_NAME} tool with your analysis. For qualityBreakdown, include one entry per rubric criterion above (using its exact key as "criterion"), each scored between 0 and its maxScore. qualityScore must equal the sum of all criterion scores. For recommendation, suggest one concrete next-best-action/follow-up the RM should take based on this conversation — if nothing further is warranted, set kind to "none" and explain briefly in text.`;
}

function buildTool() {
  return {
    name: ANALYSIS_TOOL_NAME,
    description: "Submit the structured sentiment and quality-audit analysis for a conversation.",
    input_schema: {
      type: "object" as const,
      properties: {
        sentiment: {
          type: "object",
          properties: {
            label: { type: "string", enum: ["positive", "neutral", "negative", "mixed"] },
            score: { type: "number", description: "-1 (very negative) to 1 (very positive)" },
            reasoning: { type: "string" },
          },
          required: ["label", "score", "reasoning"],
        },
        qualityBreakdown: {
          type: "array",
          items: {
            type: "object",
            properties: {
              criterion: { type: "string" },
              score: { type: "number" },
              maxScore: { type: "number" },
              notes: { type: "string" },
            },
            required: ["criterion", "score", "maxScore", "notes"],
          },
        },
        qualityScore: { type: "integer", description: "0-100, sum of qualityBreakdown scores" },
        recommendation: {
          type: "object",
          properties: {
            text: { type: "string" },
            kind: { type: "string", description: 'A short free-text label, e.g. "schedule_followup_call", "send_compliance_disclosure", "escalate_to_manager", or "none"' },
            suggestedDueInHours: { type: "number" },
          },
          required: ["text", "kind"],
        },
      },
      required: ["sentiment", "qualityBreakdown", "qualityScore", "recommendation"],
    },
  };
}

/**
 * One Claude call per conversation, returning sentiment + quality-rubric scoring + a follow-up
 * recommendation together — deliberately one consistent model doing all three, rather than mixing
 * Exotel's own generic sentiment with a separately-scored quality pass.
 *
 * If ANTHROPIC_API_KEY isn't configured, returns a canned deterministic result instead of throwing,
 * so the rest of the pipeline (task creation, notifications, UI) stays testable without a live key.
 */
export async function analyzeConversation(input: {
  transcript: string;
  sourceType: "CALL" | "WHATSAPP_THREAD";
}): Promise<ConversationAnalysis> {
  if (!isAnthropicConfigured()) {
    return {
      sentiment: { label: "neutral", score: 0, reasoning: "ANTHROPIC_API_KEY is not configured — this is a canned placeholder result." },
      qualityBreakdown: QUALITY_RUBRIC.map((c) => ({ criterion: c.key, score: 0, maxScore: c.maxScore, notes: "Not analyzed — ANTHROPIC_API_KEY is not configured." })),
      qualityScore: 0,
      recommendation: { text: "Configure ANTHROPIC_API_KEY to enable real quality-audit analysis.", kind: "none" },
    };
  }

  const truncated = input.transcript.length > MAX_TRANSCRIPT_CHARS;
  const transcript = truncated ? input.transcript.slice(-MAX_TRANSCRIPT_CHARS) : input.transcript;

  const client = getAnthropicClient();
  const tool = buildTool();

  const response = await client.messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 2048,
    tools: [tool],
    tool_choice: { type: "tool", name: ANALYSIS_TOOL_NAME },
    messages: [{ role: "user", content: buildPrompt(transcript, input.sourceType, truncated) }],
  });

  const toolUseBlock = response.content.find((block) => block.type === "tool_use" && block.name === ANALYSIS_TOOL_NAME);
  if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block for the conversation analysis");
  }

  return conversationAnalysisSchema.parse(toolUseBlock.input);
}
