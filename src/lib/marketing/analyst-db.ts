import { callModel } from "@/lib/ai/gateway";
import { prisma } from "@/lib/db/prisma";

import { addDays } from "./dates";
import { loadMarketingWorkspace } from "./report";
import { runMarketingAnalysis, toAnalystInput, type AnalysisResult } from "./analyst";

/**
 * Database side of the marketing_analyst agent: reads the blended campaign aggregates the Marketing page already computes and
 * stores one text read in MarketingAnalysis. Stores no action, changes no ad and sends nothing.
 */

export type WeeklyAnalysisOutcome = { status: "no_data" } | AnalysisResult;

const WINDOW_DAYS = 30;

export async function runWeeklyMarketingAnalysis(env: Record<string, string | undefined> = process.env, now = new Date()): Promise<WeeklyAnalysisOutcome> {
  // Off before any query: the flag and the kill switch are read from the environment alone.
  if (env.MARKETING_ANALYST_ENABLED !== "1") return { status: "off", reason: "MARKETING_ANALYST_ENABLED is not 1" };
  if (env.AI_KILL_SWITCH === "1") return { status: "off", reason: "AI_KILL_SWITCH is on" };

  const data = await loadMarketingWorkspace((today) => ({ from: addDays(today, -(WINDOW_DAYS - 1)), to: today, preset: "30d" }), now);
  if (!data.blended) return { status: "no_data" };

  const result = await runMarketingAnalysis(toAnalystInput(data.blended), { env, callModel: (input) => callModel(input) });
  if (result.status !== "ok") return result;

  await prisma.marketingAnalysis.create({
    data: {
      rangeFrom: data.blended.range.from,
      rangeTo: data.blended.range.to,
      currency: data.blended.currency,
      source: result.source,
      provider: result.provider,
      model: result.model,
      body: result.body,
      note: result.note,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  });
  return result;
}
