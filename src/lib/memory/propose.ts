import { createHash } from "node:crypto";
import { z } from "zod";

import type { LlmProvider } from "@/lib/ai/provider";
import { scrubForVendor } from "@/lib/agents/reply-assist";

import { MEMORY_CLASSES, validateProposal, type Evidence, type MemoryClassName, type Proposal } from "./rules";

/**
 * The extraction path: proposes memory items from the conversation insights that already exist (ConversationInsight). Strictly
 * DRAFT: every proposal is AI-derived, so the store creates it UNCONFIRMED and it influences nothing until a person confirms it.
 *
 * Two steps, both optional to the caller:
 *  1. proposalsFromInsights: a deterministic mapping from insight kinds to memory classes. No model call.
 *  2. refineWithModel: asks a model to find preferences, facts, goals and do-not-do requests stated in insight texts. It goes
 *     through a `MemoryModel` seam (an LlmProvider today). allvest/w1-ai-gateway is not on this branch: at integration the seam
 *     is satisfied by callModel() (purpose "memory_extraction") and nothing else here changes. Every item must carry a verbatim
 *     quote that appears in the insight it cites, or it is dropped (no unsupported inference).
 */

export type InsightRow = {
  id: string;
  kind: string;
  assetClass: string | null;
  text: string;
  severity: string | null;
  dueAt: Date | null;
  sourceType: string;
  sourceRef: string;
  occurredAt: Date;
};

export type MemoryModel = Pick<LlmProvider, "complete">;

export type Drafted = { insightId: string; proposal: Omit<Proposal, never> };

const sha = (s: string) => createHash("sha256").update(s.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 10);
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "general";

/** Evidence is a short redacted summary. Long digit runs, emails and PAN-shaped codes are masked and the text is cut to 280 characters. */
export function redact(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[id]")
    .replace(/\+?\d[\d\s-]{5,}\d/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

const sourceTypeOf = (i: InsightRow) => (i.sourceType === "CALL" ? ("call_ai" as const) : ("conversation_ai" as const));
const refPrefixOf = (i: InsightRow) => (i.sourceType === "CALL" || i.sourceType === "WHATSAPP_THREAD" ? "review" : "activity");

function evidenceOf(i: InsightRow, summary: string = i.text): Evidence {
  return { sourceRef: `insight:${i.id}`, summary: redact(summary), observedAt: i.occurredAt, via: `${refPrefixOf(i)}:${i.sourceRef}` };
}

function base(i: InsightRow, cls: MemoryClassName, key: string, value: unknown): Drafted {
  return {
    insightId: i.id,
    proposal: { class: cls, key, value, sourceType: sourceTypeOf(i), sourceRef: `insight:${i.id}`, evidence: [evidenceOf(i)], observedAt: i.occurredAt },
  };
}

/** Step 1. Pure. Kinds that are quality findings about the RM (compliance, incorrect info, missed opportunity) and bare questions are not customer memory. */
export function proposalsFromInsights(insights: readonly InsightRow[]): Drafted[] {
  const out: Drafted[] = [];
  for (const i of insights) {
    if (!i.text || !i.text.trim()) continue;
    const topic = i.assetClass ? slug(i.assetClass) : null;
    switch (i.kind) {
      case "INTEREST":
      case "PRODUCT_DISCUSSED":
        out.push(base(i, "INTEREST", `interest:${i.assetClass ?? sha(i.text)}`, i.assetClass ? { assetClass: i.assetClass } : { text: i.text }));
        break;
      case "DECLINED":
        out.push(base(i, "PRODUCT_STANCE", `product_stance:${i.assetClass ?? sha(i.text)}`, { ...(i.assetClass ? { assetClass: i.assetClass } : { text: i.text }), stance: "declined" }));
        break;
      case "OBJECTION":
      case "CONCERN":
        out.push(base(i, "OBJECTION", `objection:${topic ?? "general"}:${sha(i.text)}`, { text: i.text, ...(i.assetClass ? { assetClass: i.assetClass } : {}) }));
        break;
      case "COMMITMENT": {
        const d = base(i, "COMMITMENT", `commitment:${i.id}`, { text: i.text });
        d.proposal.dueAt = i.dueAt;
        out.push(d);
        break;
      }
      case "EXTERNAL_HOLDING":
        out.push(base(i, "FACT", `fact:external_holding:${topic ?? sha(i.text)}`, { text: i.text }));
        break;
      case "COMPLAINT":
        out.push(base(i, "SERVICE_CONTEXT", `service_context:complaint:${i.id}`, { text: i.text, ...(i.severity ? { severity: i.severity } : {}) }));
        break;
      default:
        break;
    }
  }
  return out;
}

// ---- step 2: the model seam ----------------------------------------------------------------------------------------------------------------------
const MODEL_CLASSES: readonly MemoryClassName[] = ["PREFERENCE", "FACT", "GOAL", "DO_NOT_DO"];

const modelSchema = z.object({
  items: z
    .array(
      z.object({
        insightId: z.string().min(1),
        class: z.enum(MEMORY_CLASSES),
        key: z.string().min(3).max(120),
        value: z.union([z.string().max(300), z.record(z.string(), z.union([z.string().max(300), z.number(), z.boolean(), z.null()]))]),
        quote: z.string().min(3).max(300),
      }),
    )
    .max(30),
});
export type ModelReply = z.infer<typeof modelSchema>;

export function parseModelProposals(text: string): ModelReply | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = modelSchema.safeParse(JSON.parse(cleaned));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const SYSTEM = `You read short notes about a customer of an Indian wealth-management firm and pick out only what the notes explicitly state.
Return JSON only: {"items":[{"insightId":"...","class":"PREFERENCE|FACT|GOAL|DO_NOT_DO","key":"<class lowercase>:<short_name>","value":{"text":"..."},"quote":"<exact words copied from that note>"}]}.
Rules: use only the classes PREFERENCE (how they like to be contacted, language, call time), FACT (declared facts like employer or dependants), GOAL (a stated goal) and DO_NOT_DO (something they asked us not to do).
The quote must be copied word for word from the note you cite. If a note states none of these, return nothing for it. Never infer. Never record health, religion, caste, sexual orientation, politics or vulnerability.`;

export type RefineOutcome = { proposals: Drafted[]; rejected: { insightId: string | null; reason: string }[] };

/** Step 2. At most one model call per batch; failures and garbage yield no proposals, never an error. */
export async function refineWithModel(insights: readonly InsightRow[], model: MemoryModel): Promise<RefineOutcome> {
  // What reaches the vendor is the insight text with phone numbers, PAN-shaped codes, emails and similar masked (the same scrub the reply assistant uses).
  // The quote check below runs against that same scrubbed text, so a quote is verified against exactly what the model saw.
  const usable = insights.filter((i) => i.text?.trim()).map((i) => ({ ...i, text: scrubForVendor(i.text) }));
  if (usable.length === 0) return { proposals: [], rejected: [] };
  const user = JSON.stringify(usable.slice(0, 40).map((i) => ({ insightId: i.id, text: i.text })));
  let reply: ModelReply | null = null;
  try {
    const res = await model.complete({ system: SYSTEM, user, maxTokens: 1500, timeoutMs: 30_000 });
    reply = parseModelProposals(res.text);
  } catch {
    reply = null;
  }
  const out: RefineOutcome = { proposals: [], rejected: [] };
  if (!reply) return out;
  const byId = new Map(usable.map((i) => [i.id, i]));
  for (const item of reply.items) {
    const source = byId.get(item.insightId);
    if (!source) { out.rejected.push({ insightId: item.insightId, reason: "UNKNOWN_INSIGHT" }); continue; }
    if (!MODEL_CLASSES.includes(item.class)) { out.rejected.push({ insightId: item.insightId, reason: "CLASS_NOT_ALLOWED" }); continue; }
    if (!norm(source.text).includes(norm(item.quote))) { out.rejected.push({ insightId: item.insightId, reason: "QUOTE_NOT_IN_SOURCE" }); continue; }
    const proposal: Proposal = {
      class: item.class,
      key: item.key,
      value: item.value,
      sourceType: sourceTypeOf(source),
      sourceRef: `insight:${source.id}`,
      evidence: [{ sourceRef: `insight:${source.id}`, summary: redact(item.quote), observedAt: source.occurredAt, via: `${refPrefixOf(source)}:${source.sourceRef}` }],
      observedAt: source.occurredAt,
      quoteVerified: true,
    };
    const valid = validateProposal(proposal);
    if (!valid.ok) { out.rejected.push({ insightId: item.insightId, reason: valid.code }); continue; }
    out.proposals.push({ insightId: source.id, proposal });
  }
  return out;
}
