import { createHash } from "node:crypto";
import { z } from "zod";

import { basePrisma, prisma } from "@/lib/db/prisma";
import { Prisma, type InsightKind } from "@/generated/prisma/client";
import { getAnthropicClient, isAnthropicConfigured } from "@/lib/ai/client";
import { ANALYSIS_MODEL } from "@/lib/ai/analyze-conversation";
import { createTaskIfNotExists } from "@/lib/stage-engine/create-task-if-not-exists";
import { ASSET_CLASSES, isAssetClass } from "./constants";
import { refreshCustomerIntelligence } from "./refresh";

/**
 * Reads what customers said — in call transcripts, WhatsApp threads, RM notes and support tickets — and turns it into
 * structured insights: interests, objections, concerns, complaints, commitments and what they hold elsewhere. Each is
 * stored with its source so a person can trace it back. Nothing is invented: with no API key nothing is extracted.
 */

const INSIGHT_KINDS = ["INTEREST", "OBJECTION", "QUESTION", "CONCERN", "COMMITMENT", "COMPLAINT", "PRODUCT_DISCUSSED", "DECLINED", "EXTERNAL_HOLDING", "INCORRECT_INFO", "COMPLIANCE_CONCERN", "MISSED_OPPORTUNITY"] as const;

export const extractionSchema = z.object({
  insights: z
    .array(
      z.object({
        kind: z.enum(INSIGHT_KINDS),
        assetClass: z.string().nullish(),
        text: z.string().min(3).max(300),
        severity: z.enum(["low", "medium", "high"]).nullish(),
        dueInDays: z.number().min(0).max(120).nullish(),
      }),
    )
    .max(15),
  externalHoldings: z
    .object({
      externalPortfolioInr: z.number().positive().nullish(),
      mfTransferInr: z.number().positive().nullish(),
      idleCashInr: z.number().positive().nullish(),
    })
    .nullish(),
});
export type Extraction = z.infer<typeof extractionSchema>;

const TOOL_NAME = "submit_customer_insights";
const MAX_CHARS = 12_000;

const KIND_HELP = `INTEREST: the customer showed interest in an asset class or service.
DECLINED: the customer clearly said no to / turned down an asset class or service.
OBJECTION: a reason they hesitate or push back (lock-in, fees, risk, trust, timing).
CONCERN: a worry about their money, the market, or the service that isn't a direct objection.
QUESTION: a substantive question they asked.
PRODUCT_DISCUSSED: a product or asset class the conversation covered (without interest or decline).
COMMITMENT: something the RM / Allvest promised to do for the customer ("I'll send you the statement by Friday"). Use dueInDays when a deadline is stated or implied.
COMPLAINT: the customer is dissatisfied or reports a service problem.
EXTERNAL_HOLDING: money or investments the customer holds outside Allvest, or idle cash they mentioned (also fill externalHoldings with rupee amounts when given).
INCORRECT_INFO: the RM or support said something factually wrong or misleading.
COMPLIANCE_CONCERN: the RM promised returns or guarantees, gave advice without suitability, pushed a product inappropriately, or similar.
MISSED_OPPORTUNITY: the customer opened a door the RM didn't follow up on.`;

function buildTool() {
  return {
    name: TOOL_NAME,
    description: "Submit the structured insights found in the conversation.",
    input_schema: {
      type: "object" as const,
      properties: {
        insights: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: [...INSIGHT_KINDS] },
              assetClass: { type: "string", enum: [...ASSET_CLASSES], description: "Only when the insight is about one of these asset classes." },
              text: { type: "string", description: "One short sentence, in plain language, written about the customer. Max 200 characters." },
              severity: { type: "string", enum: ["low", "medium", "high"], description: "For COMPLAINT, INCORRECT_INFO and COMPLIANCE_CONCERN only." },
              dueInDays: { type: "number", description: "For COMMITMENT only: days from the conversation until it was promised." },
            },
            required: ["kind", "text"],
          },
        },
        externalHoldings: {
          type: "object",
          description: "Only when the customer states amounts. Rupees, as plain numbers.",
          properties: {
            externalPortfolioInr: { type: "number", description: "Total invested elsewhere (outside Allvest)." },
            mfTransferInr: { type: "number", description: "Mutual funds held elsewhere that could be transferred." },
            idleCashInr: { type: "number", description: "Cash sitting idle in bank accounts." },
          },
        },
      },
      required: ["insights"],
    },
  };
}

/** One Claude call. Returns null when no API key is configured — callers then leave the source unprocessed. */
export async function extractInsights(input: { text: string; sourceLabel: string; today?: Date }): Promise<Extraction | null> {
  if (!isAnthropicConfigured()) return null;
  const text = input.text.length > MAX_CHARS ? input.text.slice(-MAX_CHARS) : input.text;
  const today = (input.today ?? new Date()).toISOString().slice(0, 10);
  const response = await getAnthropicClient().messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 2048,
    tools: [buildTool()],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content: `You read customer conversations for a wealth-management firm in India and extract what matters. Today is ${today}.

Source: ${input.sourceLabel}

Rules:
- Extract only what is explicitly said or clearly implied. Never guess. If there is nothing worth recording, return an empty list.
- Skip pleasantries and anything that is just the RM talking.
- Write each insight as one short, factual sentence about the customer.
- Use an asset class only from: ${ASSET_CLASSES.join(", ")}.

Insight kinds:
${KIND_HELP}

Conversation:
"""
${text}
"""

Call the ${TOOL_NAME} tool with the result.`,
      },
    ],
  });
  const block = response.content.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
  if (!block || block.type !== "tool_use") throw new Error("Claude did not return insights");
  return extractionSchema.parse(block.input);
}

const DAY = 24 * 60 * 60 * 1000;

/** The same fact turning up again — in another pass, or from a note about the call it came from — is one insight. */
function dedupeKey(clientId: string, kind: string, text: string): string {
  const normalised = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
  return createHash("sha256").update(`${clientId}|${kind}|${normalised}`).digest("hex").slice(0, 40);
}

async function notifyManagersAndAdmins(clientId: string, type: string, payload: Record<string, unknown>) {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { assignedTo: { select: { id: true, managerId: true } } } });
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  const recipients = new Set<string>(admins.map((a) => a.id));
  if (client?.assignedTo?.managerId) recipients.add(client.assignedTo.managerId);
  await Promise.all([...recipients].map((userId) => prisma.notification.create({ data: { userId, type, payload: payload as Prisma.InputJsonValue } })));
}

/** Stores an extraction for a client and acts on it (tasks, alerts, estimates), then refreshes their intelligence. */
export async function saveExtraction(input: { clientId: string; sourceType: "CALL" | "WHATSAPP_THREAD" | "NOTE" | "TICKET"; sourceRef: string; occurredAt: Date; extraction: Extraction }): Promise<number> {
  const { clientId, sourceType, sourceRef, occurredAt, extraction } = input;
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, assignedToId: true, assignedTo: { select: { managerId: true } } } });
  if (!client) return 0;

  let created = 0;
  for (const item of extraction.insights) {
    const assetClass = isAssetClass(item.assetClass) ? item.assetClass : null;
    const text = item.text.replace(/\s+/g, " ").trim().slice(0, 300);
    const key = dedupeKey(clientId, item.kind, text);
    const dueAt = item.kind === "COMMITMENT" ? new Date(occurredAt.getTime() + (item.dueInDays ?? 2) * DAY) : null;
    let row;
    try {
      row = await basePrisma.conversationInsight.create({
        data: { clientId, kind: item.kind as InsightKind, assetClass, text, severity: item.severity ?? null, dueAt, sourceType, sourceRef, dedupeKey: key, occurredAt },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue; // already recorded from an earlier pass
      throw error;
    }
    created += 1;

    if (item.kind === "COMMITMENT" && client.assignedToId && dueAt) {
      await createTaskIfNotExists({ clientId, assignedToId: client.assignedToId, title: `Promised: ${text.slice(0, 120)}`, dueAt, source: `commitment:${row.id}` });
    }
    if (item.kind === "COMPLAINT") {
      const recipients = new Set([client.assignedToId, client.assignedTo?.managerId].filter((x): x is string => !!x));
      await Promise.all([...recipients].map((userId) => prisma.notification.create({ data: { userId, type: "service_issue_open", payload: { clientId, clientName: client.name, text } } })));
    }
    if ((item.kind === "COMPLIANCE_CONCERN" || item.kind === "INCORRECT_INFO") && item.severity !== "low") {
      await notifyManagersAndAdmins(clientId, "compliance_flag", { clientId, clientName: client.name, kind: item.kind, text });
    }
  }

  const holdings = extraction.externalHoldings;
  if (holdings && (holdings.externalPortfolioInr || holdings.mfTransferInr || holdings.idleCashInr)) {
    if (!(await basePrisma.customerIntelligence.findUnique({ where: { clientId }, select: { clientId: true } }))) await refreshCustomerIntelligence(clientId, { fireTriggers: false });
    // What an RM entered is more reliable than what we inferred from a chat: never overwrite it.
    await basePrisma.customerIntelligence.updateMany({
      where: { clientId, OR: [{ estimatesSource: null }, { estimatesSource: { not: "rm" } }] },
      data: {
        ...(holdings.externalPortfolioInr ? { externalPortfolioEstimate: holdings.externalPortfolioInr } : {}),
        ...(holdings.mfTransferInr ? { mfTransferEstimate: holdings.mfTransferInr } : {}),
        ...(holdings.idleCashInr ? { idleCashEstimate: holdings.idleCashInr } : {}),
        estimatesSource: "ai",
        estimatesUpdatedAt: new Date(),
      },
    });
  }

  await refreshCustomerIntelligence(clientId);
  return created;
}

const REVIEW_BATCH = 8;
const NOTE_CLIENT_BATCH = 8;

/** Calls and WhatsApp threads that Quality Audit has already transcribed. */
export async function extractInsightsFromReviews(): Promise<{ reviews: number; insights: number }> {
  if (!isAnthropicConfigured()) return { reviews: 0, insights: 0 };
  const reviews = await prisma.conversationReview.findMany({
    where: { insightsExtractedAt: null, status: "ANALYZED", transcript: { not: null } },
    orderBy: { createdAt: "asc" },
    take: REVIEW_BATCH,
    select: { id: true, clientId: true, sourceType: true, transcript: true, createdAt: true },
  });
  let insights = 0;
  for (const review of reviews) {
    try {
      const extraction = await extractInsights({ text: review.transcript ?? "", sourceLabel: review.sourceType === "CALL" ? "Phone call between an RM and a customer" : "WhatsApp conversation between an RM and a customer", today: review.createdAt });
      if (!extraction) continue;
      insights += await saveExtraction({ clientId: review.clientId, sourceType: review.sourceType === "CALL" ? "CALL" : "WHATSAPP_THREAD", sourceRef: review.id, occurredAt: review.createdAt, extraction });
      await basePrisma.conversationReview.update({ where: { id: review.id }, data: { insightsExtractedAt: new Date() } });
    } catch (error) {
      console.error("Insight extraction failed for review", review.id, error);
    }
  }
  return { reviews: reviews.length, insights };
}

type NoteRow = { id: string; clientId: string; type: string; createdAt: Date; payload: unknown };

function noteText(activity: NoteRow): string {
  const payload = (activity.payload ?? {}) as Record<string, unknown>;
  const parts = [payload.message, payload.subject, payload.description].filter((x): x is string => typeof x === "string");
  return parts.join(" — ").replace(/\s+/g, " ").trim();
}

/** Automatic system notes are not conversations; only substantial, human-written text is read. */
function isConversational(activity: NoteRow): boolean {
  const payload = (activity.payload ?? {}) as Record<string, unknown>;
  if (payload.source === "device" || payload.eventType === "campaign_event") return false;
  const text = noteText(activity);
  if (text.length < 40) return false;
  return !/^(Client created|Reassigned|Funding status|KYC |Stage |Lead assignment|Auto-assignment|Enquired again|New lead from)/i.test(text);
}

/** RM notes and support tickets written since each customer was last read. */
export async function extractInsightsFromNotes(): Promise<{ clients: number; insights: number }> {
  if (!isAnthropicConfigured()) return { clients: 0, insights: 0 };
  const since = new Date(Date.now() - 14 * DAY);
  const recent = await prisma.activity.findMany({
    where: { createdAt: { gte: since }, OR: [{ type: "TICKET" }, { type: "NOTE", userId: { not: null } }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, clientId: true, type: true, createdAt: true, payload: true },
    take: 500,
  });
  const byClient = new Map<string, NoteRow[]>();
  for (const a of recent) if (isConversational(a)) byClient.set(a.clientId, [...(byClient.get(a.clientId) ?? []), a]);

  let clients = 0;
  let insights = 0;
  for (const [clientId, activities] of byClient) {
    if (clients >= NOTE_CLIENT_BATCH) break;
    const state = await prisma.customerIntelligence.findUnique({ where: { clientId }, select: { lastInsightAt: true } });
    const fresh = activities.filter((a) => !state?.lastInsightAt || a.createdAt > state.lastInsightAt);
    if (fresh.length === 0) continue;
    clients += 1;
    try {
      for (const sourceType of ["NOTE", "TICKET"] as const) {
        const batch = fresh.filter((a) => (sourceType === "TICKET" ? a.type === "TICKET" : a.type === "NOTE"));
        if (batch.length === 0) continue;
        const text = batch.map((a) => `[${a.createdAt.toISOString().slice(0, 10)}] ${noteText(a)}`).join("\n");
        const extraction = await extractInsights({ text, sourceLabel: sourceType === "TICKET" ? "Support tickets from a customer" : "Notes written by an RM about a customer", today: new Date() });
        if (!extraction) continue;
        insights += await saveExtraction({ clientId, sourceType, sourceRef: batch[batch.length - 1].id, occurredAt: batch[batch.length - 1].createdAt, extraction });
      }
      // The watermark lives on the intelligence row (saveExtraction refreshes it into existence).
      await basePrisma.customerIntelligence.updateMany({ where: { clientId }, data: { lastInsightAt: new Date() } });
    } catch (error) {
      console.error("Insight extraction from notes failed for", clientId, error);
    }
  }
  return { clients, insights };
}

/** Cron entry point. */
export async function extractConversationInsights() {
  const reviews = await extractInsightsFromReviews();
  const notes = await extractInsightsFromNotes();
  return { reviews, notes };
}
