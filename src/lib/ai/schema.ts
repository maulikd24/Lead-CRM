import { z } from "zod";

export const conversationAnalysisSchema = z.object({
  sentiment: z.object({
    label: z.enum(["positive", "neutral", "negative", "mixed"]),
    score: z.number().min(-1).max(1),
    reasoning: z.string(),
  }),
  qualityBreakdown: z.array(
    z.object({
      criterion: z.string(),
      score: z.number(),
      maxScore: z.number(),
      notes: z.string(),
    }),
  ),
  qualityScore: z.number().int().min(0).max(100),
  recommendation: z.object({
    text: z.string(),
    kind: z.string(),
    suggestedDueInHours: z.number().positive().optional(),
  }),
});

export type ConversationAnalysis = z.infer<typeof conversationAnalysisSchema>;
