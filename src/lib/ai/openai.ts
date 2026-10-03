import OpenAI from "openai";

let client: OpenAI | null = null;

/** Lazily-initialized singleton — OPENAI_API_KEY is read on first use, so a missing key only affects AI summaries. */
export function getOpenAiClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Configurable so the model can be changed without a deploy of code (set OPENAI_SUMMARY_MODEL in Vercel). */
export function getSummaryModel(): string {
  return process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini";
}
