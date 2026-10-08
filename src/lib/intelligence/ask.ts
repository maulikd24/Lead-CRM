import type Anthropic from "@anthropic-ai/sdk";

import type { Prisma } from "@/generated/prisma/client";
import { getAnthropicClient, isAnthropicConfigured } from "@/lib/ai/client";
import { ANALYSIS_MODEL } from "@/lib/ai/analyze-conversation";
import { getReportsPageData } from "@/lib/reports/get-reports-page-data";
import { ASSET_CLASSES, CUSTOMER_CATEGORIES, LIFECYCLE_STAGES, NBA_PROGRAMMES, SEGMENTS } from "./constants";
import { getFunnel, getLifecycleCounts, getSegmentCounts, getTeamFollowups, getTopObjections, listCustomers, type CustomerRow } from "./management";

/**
 * "Ask the system": management questions answered from live data. Claude never sees the database — it picks from a
 * fixed set of read-only tools, each scoped to the asker's own customers, and writes the answer from what they return.
 */

const TOOLS: Anthropic.Tool[] = [
  {
    name: "find_customers",
    description: "List customers (with their lifecycle stage and next best action) matching filters. Use for questions like 'which HNI clients have high PMS acceptance' or 'which KYC customers have not funded'.",
    input_schema: {
      type: "object",
      properties: {
        lifecycle: { type: "string", enum: [...LIFECYCLE_STAGES] },
        category: { type: "string", enum: [...CUSTOMER_CATEGORIES] },
        segment: { type: "string", enum: Object.keys(SEGMENTS), description: "A saved segment such as dormant, kyc_dropoff, unfunded, cross_sell, review_due." },
        nba_programme: { type: "string", enum: [...NBA_PROGRAMMES] },
        priority: { type: "string", enum: ["High", "Medium", "Low"] },
        timing: { type: "string", enum: ["Today", "This Week", "Later", "Trigger-based"] },
        acceptance_asset_class: { type: "string", enum: [...ASSET_CLASSES] },
        acceptance_level: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
        assigned_rm: { type: "string", description: "Part of an RM's name." },
        limit: { type: "number", description: "Max rows, default 15." },
      },
    },
  },
  { name: "funnel", description: "Funnel totals (customers, KYC approved, funded, activated) and conversion by lead source.", input_schema: { type: "object", properties: {} } },
  { name: "lifecycle_breakdown", description: "How many customers sit at each lifecycle stage and in each segment — to see where customers are being lost in the journey.", input_schema: { type: "object", properties: {} } },
  { name: "team_followups", description: "Open and overdue follow-up tasks per RM, plus the number of unassigned customers.", input_schema: { type: "object", properties: {} } },
  { name: "top_objections", description: "Recent objections customers raised (last 90 days), optionally for one asset class.", input_schema: { type: "object", properties: { asset_class: { type: "string", enum: [...ASSET_CLASSES] } } } },
  { name: "stage_conversion", description: "Onboarding stage-to-stage conversion: what share of customers reach each stage.", input_schema: { type: "object", properties: {} } },
];

type AskResult = { answer: string; customers: CustomerRow[] };

async function runTool(name: string, input: Record<string, unknown>, scope: Prisma.ClientWhereInput, visibleUserIds: string[] | null): Promise<{ result: unknown; customers?: CustomerRow[] }> {
  switch (name) {
    case "find_customers": {
      const where: Prisma.CustomerIntelligenceWhereInput = {
        ...(input.lifecycle ? { lifecycleStage: String(input.lifecycle) } : {}),
        ...(input.nba_programme ? { nbaProgramme: String(input.nba_programme) } : {}),
        ...(input.priority ? { nbaPriority: String(input.priority) } : {}),
        ...(input.timing ? { nbaTiming: String(input.timing) } : {}),
        client: {
          ...(input.category ? { customerCategory: String(input.category) } : {}),
          ...(input.segment ? { segmentMemberships: { some: { segment: String(input.segment), exitedAt: null } } } : {}),
          ...(input.acceptance_asset_class && input.acceptance_level ? { acceptances: { some: { assetClass: String(input.acceptance_asset_class), level: String(input.acceptance_level) as "HIGH" } } } : {}),
          ...(input.assigned_rm ? { assignedTo: { name: { contains: String(input.assigned_rm), mode: "insensitive" as const } } } : {}),
        },
      };
      const { total, rows } = await listCustomers(scope, where, Math.min(25, Number(input.limit) || 15));
      return { result: { total, shown: rows.length, customers: rows.map((r) => ({ name: r.name, code: r.code, rm: r.rm, stage: r.lifecycle, nextAction: r.programme, priority: r.priority, when: r.timing })) }, customers: rows };
    }
    case "funnel":
      return { result: await getFunnel(scope) };
    case "lifecycle_breakdown":
      return { result: { lifecycle: await getLifecycleCounts(scope), segments: await getSegmentCounts(scope) } };
    case "team_followups":
      return { result: await getTeamFollowups(scope) };
    case "top_objections":
      return { result: await getTopObjections(scope, input.asset_class ? String(input.asset_class) : undefined) };
    case "stage_conversion": {
      const data = await getReportsPageData({ ...scope }, visibleUserIds, new Date());
      return { result: data.conversionData.map((c) => ({ stage: c.stage, reached: c.reached, percentOfAll: c.pct })) };
    }
    default:
      return { result: { error: `Unknown tool ${name}` } };
  }
}

export async function askTheSystem(question: string, scope: Prisma.ClientWhereInput, visibleUserIds: string[] | null): Promise<AskResult> {
  if (!isAnthropicConfigured()) throw new Error("Asking questions needs the Anthropic API key — an Admin needs to add it.");
  const client = getAnthropicClient();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question.slice(0, 500) }];
  let customers: CustomerRow[] = [];

  for (let round = 0; round < 5; round += 1) {
    const response = await client.messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 1024,
      system: `You answer management questions about a wealth-management firm's customers using the provided tools only. Today is ${new Date().toISOString().slice(0, 10)}.
- Use the tools to get the facts; never guess a number or a name. If the tools can't answer, say what is missing.
- Answer in plain English in under 120 words, leading with the answer. Use bullet points for lists.
- Customer names and counts are fine to state; the full list is shown to the user separately, so don't repeat every row.`,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason !== "tool_use") {
      const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { answer: text || "I couldn't work out an answer from the data available.", customers };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      try {
        const { result, customers: found } = await runTool(block.name, (block.input ?? {}) as Record<string, unknown>, scope, visibleUserIds);
        if (found && found.length > 0) customers = found;
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result).slice(0, 12_000) });
      } catch (error) {
        results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: error instanceof Error ? error.message : "Tool failed" });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { answer: "That question needed more steps than I allow — try asking something narrower.", customers };
}
