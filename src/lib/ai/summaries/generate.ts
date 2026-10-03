import { createHash } from "node:crypto";

import { prisma } from "@/lib/db/prisma";
import { getOpenAiClient, getSummaryModel, isOpenAiConfigured } from "@/lib/ai/openai";

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI summaries aren't set up yet — an Admin needs to add the OpenAI API key.");
  }
}

const HOURLY_LIMIT = 30;

const SYSTEM_PROMPT = `You write brief page summaries for a wealth-management CRM used by relationship managers in India.
Use ONLY the facts supplied. Never invent numbers, names, dates or events; if something is not in the facts, say it is not available.
Format: 3 to 6 short bullet points, each starting with "• ", then a final line starting with "Next: " naming the single most useful next step.
Plain language, no markdown headings, under 130 words. Amounts are Indian rupees (₹).`;

export type GeneratedSummary = { summary: string; cached: boolean; generatedAt: Date; model: string };

/**
 * Turns a fact sheet into a short AI summary. Results are cached by a hash of the exact facts, so unchanged data
 * costs nothing; `force` regenerates. Per-user hourly cap keeps a runaway client from burning the API budget.
 */
export async function generateSummary(input: {
  kind: string;
  subjectKey: string;
  userId: string;
  instruction: string;
  facts: string;
  force?: boolean;
}): Promise<GeneratedSummary> {
  if (!isOpenAiConfigured()) throw new AiNotConfiguredError();

  const contentHash = createHash("sha256").update(`${input.kind}\n${input.instruction}\n${input.facts}`).digest("hex");
  const where = { kind_subjectKey_contentHash: { kind: input.kind, subjectKey: input.subjectKey, contentHash } };

  if (!input.force) {
    const cached = await prisma.aiSummary.findUnique({ where });
    if (cached) return { summary: cached.summary, cached: true, generatedAt: cached.createdAt, model: cached.model };
  }

  const recent = await prisma.aiSummary.count({ where: { userId: input.userId, createdAt: { gte: new Date(new Date().getTime() - 60 * 60 * 1000) } } });
  if (recent >= HOURLY_LIMIT) throw new Error("You've reached the hourly limit for AI summaries — please try again later.");

  const model = getSummaryModel();
  const completion = await getOpenAiClient().chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `${input.instruction}\n\nFACTS:\n${input.facts}` },
    ],
  });
  const summary = completion.choices[0]?.message?.content?.trim();
  if (!summary) throw new Error("The AI returned an empty summary — please try again.");

  const saved = await prisma.aiSummary.upsert({
    where,
    update: { summary, model, userId: input.userId, createdAt: new Date() },
    create: { kind: input.kind, subjectKey: input.subjectKey, contentHash, summary, model, userId: input.userId },
  });
  return { summary: saved.summary, cached: false, generatedAt: saved.createdAt, model };
}
